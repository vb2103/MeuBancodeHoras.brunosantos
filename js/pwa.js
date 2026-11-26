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

export const PRESET_RULE_MAP = {
  sindpd: {
    presetKey: 'sindpd',
    unionCode: 'sindpd_sp',
    sectorCode: 'tecnologia',
    label: 'SINDPD-SP — Tecnologia (Feriado 1,4x)'
  },
  sindpd_sp: {
    presetKey: 'sindpd',
    unionCode: 'sindpd_sp',
    sectorCode: 'tecnologia',
    label: 'SINDPD-SP — Tecnologia (Feriado 1,4x)'
  },
  industria: {
    presetKey: 'industria',
    unionCode: 'metalurgicos',
    sectorCode: 'industria',
    label: 'Indústria / Metalúrgicos (Feriado 2,0x)'
  },
  bancarios: {
    presetKey: 'bancarios',
    unionCode: 'bancarios',
    sectorCode: 'financeiro',
    label: 'Bancários / Financeiro'
  },
  saude: {
    presetKey: 'saude',
    unionCode: 'saude',
    sectorCode: 'saude',
    label: 'Saúde / Escala 12x36'
  },
  comercio: {
    presetKey: 'comercio',
    unionCode: 'comerciarios',
    sectorCode: 'comercio',
    label: 'Comércio & Varejo (1,0x)'
  },
  servicos: {
    presetKey: 'servicos',
    unionCode: 'clt_individual',
    sectorCode: 'servicos',
    label: 'Serviços / CLT Padrão (1,0x)'
  }
};

export function resolvePresetRule(rawPreset) {
  const key = String(rawPreset || '').trim().toLowerCase();
  return PRESET_RULE_MAP[key] || null;
}

/**
 * Extrai e valida parâmetros de inicialização (?atalho=, ?mode=, ?preset=, ?h=, ?m=)
 * preservando parâmetros de sessão/PKCE do Supabase e devolvendo a URL limpa.
 */
export function parseAndCleanAppLaunchUrl(href) {
  const empty = {
    shortcut: null,
    mode: null,
    preset: null,
    hours: null,
    minutes: null,
    cleanUrl: './',
    hadParam: false
  };
  if (!href || typeof href !== 'string') return empty;
  try {
    const url = new URL(href, 'https://saldohoras.local/');
    const launchKeys = ['atalho', 'mode', 'preset', 'h', 'm'];
    const hadParam = launchKeys.some((k) => url.searchParams.has(k));

    const rawShortcut = String(url.searchParams.get('atalho') || '').trim().toLowerCase();
    const shortcut = rawShortcut === 'ganho' || rawShortcut === 'folga' ? rawShortcut : null;

    const rawMode = String(url.searchParams.get('mode') || '').trim().toLowerCase();
    const mode = rawMode === 'login' || rawMode === 'signup' ? rawMode : null;

    const preset = resolvePresetRule(url.searchParams.get('preset'));

    const rawH = url.searchParams.get('h');
    const rawM = url.searchParams.get('m');
    const parsedH = rawH !== null && rawH !== '' && Number.isFinite(Number(rawH))
      ? Math.max(0, Math.min(24, Math.trunc(Number(rawH))))
      : null;
    const parsedM = rawM !== null && rawM !== '' && Number.isFinite(Number(rawM))
      ? Math.max(0, Math.min(59, Math.trunc(Number(rawM))))
      : null;

    if (hadParam) {
      launchKeys.forEach((k) => url.searchParams.delete(k));
    }
    const cleanUrl = `${url.pathname}${url.search}${url.hash}` || './';
    return {
      shortcut,
      mode,
      preset,
      hours: parsedH,
      minutes: parsedM,
      cleanUrl,
      hadParam
    };
  } catch {
    return empty;
  }
}

export function savePendingRulePreset(data, storageOverride) {
  const storage = storageOverride || (typeof globalThis.sessionStorage !== 'undefined' ? globalThis.sessionStorage : null);
  const preset = data?.preset ? data.preset : resolvePresetRule(data?.presetKey || data);
  if (!storage || !preset) return false;
  try {
    storage.setItem(
      STORAGE_KEYS.PENDING_PRESET,
      JSON.stringify({
        presetKey: preset.presetKey,
        unionCode: preset.unionCode,
        sectorCode: preset.sectorCode,
        label: preset.label,
        hours: Number.isFinite(Number(data?.hours)) ? Number(data.hours) : null,
        minutes: Number.isFinite(Number(data?.minutes)) ? Number(data.minutes) : null,
        savedAt: Date.now()
      })
    );
    return true;
  } catch {
    return false;
  }
}

export function loadPendingRulePreset(storageOverride) {
  const storage = storageOverride || (typeof globalThis.sessionStorage !== 'undefined' ? globalThis.sessionStorage : null);
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEYS.PENDING_PRESET);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const base = resolvePresetRule(parsed?.presetKey || parsed?.unionCode);
    if (!base && !parsed?.unionCode) return null;
    return {
      presetKey: parsed?.presetKey || base?.presetKey || '',
      unionCode: parsed?.unionCode || base?.unionCode || 'sindpd_sp',
      sectorCode: parsed?.sectorCode || base?.sectorCode || 'tecnologia',
      label: parsed?.label || base?.label || '',
      hours: Number.isFinite(Number(parsed?.hours)) ? Number(parsed.hours) : null,
      minutes: Number.isFinite(Number(parsed?.minutes)) ? Number(parsed.minutes) : null
    };
  } catch {
    return null;
  }
}

export function clearPendingRulePreset(storageOverride) {
  const storage = storageOverride || (typeof globalThis.sessionStorage !== 'undefined' ? globalThis.sessionStorage : null);
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEYS.PENDING_PRESET);
  } catch { /* ignore */ }
}

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
