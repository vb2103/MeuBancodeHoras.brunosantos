import { APP_VERSION, STORAGE_KEYS } from './config.js';

const USER_PREFIXES_TO_CLEAR = [
  STORAGE_KEYS.CACHE_PREFIX,
  STORAGE_KEYS.QUEUE_PREFIX,
  STORAGE_KEYS.CYCLES_PREFIX,
  STORAGE_KEYS.ONBOARDING_PREFIX,
  'saldohoras_draft',
  'sb-',
  'supabase.'
];

const USER_EXACT_KEYS_TO_CLEAR = new Set([
  STORAGE_KEYS.PRIVACY,
  STORAGE_KEYS.HOLIDAY_UF,
  STORAGE_KEYS.GUEST_STATE,
  STORAGE_KEYS.GUEST_ACTIVE,
  STORAGE_KEYS.GUEST_BANNER_DISMISSED
]);

const FALLBACK_IDB_NAMES = ['saldohoras', 'saldohoras_db', 'saldohoras-offline', 'supabase-auth'];

/**
 * Extrai e valida o atalho PWA (?atalho=ganho | ?atalho=folga) e calcula a URL limpa sem o parâmetro.
 */
export function parseAndCleanShortcutUrl(href) {
  if (!href || typeof href !== 'string') {
    return { shortcut: null, cleanUrl: './', hadParam: false };
  }
  try {
    const url = new URL(href, 'https://saldohoras.local/');
    const hadParam = url.searchParams.has('atalho');
    const raw = hadParam ? String(url.searchParams.get('atalho') || '').trim().toLowerCase() : '';
    const shortcut = raw === 'ganho' || raw === 'folga' ? raw : null;
    if (hadParam) {
      url.searchParams.delete('atalho');
    }
    const cleanUrl = `${url.pathname}${url.search}${url.hash}` || './';
    return { shortcut, cleanUrl, hadParam };
  } catch {
    return { shortcut: null, cleanUrl: './', hadParam: false };
  }
}

/**
 * Lista todas as chaves pertencentes a sessão/dados de usuário a remover no logout.
 * Preserva preferência visual de tema do aparelho e não toca em Cache Storage do Service Worker.
 */
export function collectUserStorageKeysToClear(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
    return [];
  }
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (
      USER_EXACT_KEYS_TO_CLEAR.has(key)
      || USER_PREFIXES_TO_CLEAR.some((prefix) => key.startsWith(prefix))
    ) {
      keys.push(key);
    }
  }
  return keys;
}

function removeKeysFromStorage(storage) {
  if (!storage) return 0;
  try {
    const toRemove = collectUserStorageKeysToClear(storage);
    for (const key of toRemove) {
      storage.removeItem(key);
    }
    return toRemove.length;
  } catch {
    return 0;
  }
}

function deleteIdbDatabaseSafe(idb, dbName) {
  return new Promise((resolve) => {
    if (!idb || typeof idb.deleteDatabase !== 'function' || !dbName) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 450);
    try {
      const req = idb.deleteDatabase(dbName);
      req.onsuccess = () => {
        clearTimeout(timer);
        finish(true);
      };
      req.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        finish(false);
      };
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

/**
 * Limpa integralmente chaves de usuário em localStorage, sessionStorage e bancos IndexedDB.
 * Mantém intacto o Cache Storage do Service Worker.
 */
export async function clearClientUserStorage({
  local = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null,
  session = typeof globalThis.sessionStorage !== 'undefined' ? globalThis.sessionStorage : null,
  idb = typeof globalThis.indexedDB !== 'undefined' ? globalThis.indexedDB : null
} = {}) {
  const removedLocal = removeKeysFromStorage(local);
  const removedSession = removeKeysFromStorage(session);

  let clearedIdbNames = [];
  if (idb && typeof idb.deleteDatabase === 'function') {
    const targetNames = new Set(FALLBACK_IDB_NAMES);
    if (typeof idb.databases === 'function') {
      try {
        const listed = await idb.databases();
        for (const item of listed || []) {
          if (item?.name) targetNames.add(item.name);
        }
      } catch {
        // Fallback usa lista conhecida se o navegador restringir databases()
      }
    }
    const results = await Promise.all(
      Array.from(targetNames).map(async (name) => ((await deleteIdbDatabaseSafe(idb, name)) ? name : null))
    );
    clearedIdbNames = results.filter(Boolean);
  }

  return { removedLocal, removedSession, clearedIdbNames };
}

/**
 * Monta mensagem de alerta quando o usuário tenta sair com itens pendentes na fila offline.
 */
export function formatPendingLogoutWarning(pendingCount) {
  const count = Math.max(1, Math.round(Number(pendingCount) || 0));
  if (count === 1) {
    return 'Você tem 1 alteração ainda não enviada para a nuvem. Se sair agora sem internet, ela será perdida.';
  }
  return `Você tem ${count} alterações ainda não enviadas para a nuvem. Se sair agora sem internet, elas serão perdidas.`;
}

function waitForWorkerInstalled(worker, timeoutMs = 6000) {
  if (!worker) return Promise.resolve(false);
  if (worker.state === 'installed') return Promise.resolve(true);
  if (worker.state === 'redundant' || worker.state === 'activated') return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('statechange', onChange);
      clearTimeout(timer);
      resolve(ok);
    };
    const onChange = () => {
      if (worker.state === 'installed') done(true);
      else if (worker.state === 'redundant' || worker.state === 'activated') done(false);
    };
    const timer = setTimeout(() => done(worker.state === 'installed'), timeoutMs);
    worker.addEventListener('statechange', onChange);
  });
}

/**
 * Registra e gerencia atualizações controladas do Service Worker (PWA),
 * exibindo Toast discreto quando houver versão aguardando sem forçar reload repentino.
 */
export function initServiceWorkerUpdates({
  onToast,
  swUrl = './sw.js',
  scope = './',
  version = APP_VERSION
} = {}) {
  let swRegistration = null;
  let waitingWorker = null;
  let allowControlledReload = false;
  let reloadingPage = false;
  let lastAutoCheckAt = 0;

  function applyWaitingUpdate(targetWorker = waitingWorker || swRegistration?.waiting) {
    if (!targetWorker) return false;
    allowControlledReload = true;
    targetWorker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  function notifyUpdateAvailable(worker) {
    if (!worker || !navigator.serviceWorker?.controller) return;
    waitingWorker = worker;
    onToast?.('Nova versão disponível', {
      actionLabel: 'Atualizar',
      duration: 0,
      onAction: () => applyWaitingUpdate(worker)
    });
  }

  function wireRegistration(reg) {
    if (!reg) return;
    swRegistration = reg;

    if (reg.waiting && navigator.serviceWorker?.controller) {
      notifyUpdateAvailable(reg.waiting);
    }

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker?.controller) {
          notifyUpdateAvailable(reg.waiting || installing);
        }
      });
    });
  }

  async function safeAutoUpdate() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (now - lastAutoCheckAt < 15000) return;
    lastAutoCheckAt = now;
    try {
      const reg = swRegistration || (await navigator.serviceWorker.getRegistration?.(scope));
      if (reg) {
        swRegistration = reg;
        if (reg.waiting && navigator.serviceWorker?.controller) {
          notifyUpdateAvailable(reg.waiting);
          return;
        }
        await reg.update();
      }
    } catch {
      // Falha de rede ao buscar atualização é ignorada silenciosamente
    }
  }

  async function checkForUpdatesManual() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      onToast?.('Atualizações indisponíveis neste modo.');
      return { status: 'unsupported' };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onToast?.('Sem conexão — utilizando versão offline salva no aparelho.');
      return { status: 'offline' };
    }

    try {
      const reg = swRegistration || (await navigator.serviceWorker.getRegistration?.(scope));
      if (!reg) {
        onToast?.('Service Worker ainda não registrado nesta aba.');
        return { status: 'unregistered' };
      }
      swRegistration = reg;

      if (reg.waiting && navigator.serviceWorker?.controller) {
        notifyUpdateAvailable(reg.waiting);
        return { status: 'update_available' };
      }

      onToast?.(`Verificando atualizações (v${version})...`, { duration: 2200 });
      await reg.update();

      if (reg.installing) {
        await waitForWorkerInstalled(reg.installing, 6000);
      }

      if (reg.waiting && navigator.serviceWorker?.controller) {
        notifyUpdateAvailable(reg.waiting);
        return { status: 'update_available' };
      }

      onToast?.(`Você já está na versão mais recente (v${version})!`);
      return { status: 'up_to_date' };
    } catch {
      onToast?.('Não foi possível verificar atualizações agora.');
      return { status: 'error' };
    }
  }

  if (typeof window !== 'undefined' && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!allowControlledReload || reloadingPage) return;
      reloadingPage = true;
      window.location.reload();
    });

    const registerSw = async () => {
      try {
        const reg = await navigator.serviceWorker.register(swUrl, { scope, updateViaCache: 'none' });
        wireRegistration(reg);
        lastAutoCheckAt = Date.now();
        await reg.update().catch(() => null);
      } catch {
        // Falha silenciosa caso navegador restrinja SW em ambiente de teste
      }
    };

    if (document.readyState === 'complete') {
      void registerSw();
    } else {
      window.addEventListener('load', () => {
        void registerSw();
      }, { once: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void safeAutoUpdate();
      }
    });

    window.addEventListener('focus', () => {
      void safeAutoUpdate();
    });

    window.addEventListener('online', () => {
      void safeAutoUpdate();
    });
  }

  return {
    checkForUpdatesManual,
    applyWaitingUpdate,
    getVersion: () => version
  };
}
