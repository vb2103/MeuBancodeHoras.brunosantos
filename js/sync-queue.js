import { STORAGE_KEYS } from './config.js';

function getSafeStorage(storageOverride) {
  if (storageOverride) return storageOverride;
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
}

/**
 * Enfileira uma alteração pendente mesclando de forma idempotente por entidade.
 */
export function enqueueSyncOp(queue = [], op) {
  const list = Array.isArray(queue) ? [...queue] : [];
  if (!op || !op.kind) return list;

  if (op.kind === 'settings') {
    const filtered = list.filter((item) => item.kind !== 'settings');
    filtered.push({ kind: 'settings', settings: op.settings, ts: op.ts || Date.now() });
    return filtered;
  }

  if (op.kind === 'upsert' && op.entry?.id) {
    const filtered = list.filter((item) => !(item.kind !== 'settings' && item.id === op.entry.id && (!item.entry || item.entry.id === op.entry.id)));
    filtered.push({ kind: 'upsert', id: op.entry.id, entry: op.entry, ts: op.ts || Date.now() });
    return filtered;
  }

  if (op.kind === 'delete' && op.id) {
    const filtered = list.filter((item) => !(item.kind !== 'settings' && (item.id === op.id || item.entry?.id === op.id)));
    filtered.push({ kind: 'delete', id: op.id, ts: op.ts || Date.now() });
    return filtered;
  }

  return list;
}

/**
 * Aplica alterações locais ainda não sincronizadas sobre os dados base da nuvem/cache.
 */
export function applyQueueToState(baseState = {}, queue = []) {
  let nextSettings = baseState.settings ? { ...baseState.settings } : baseState.settings;
  let nextEntries = Array.isArray(baseState.entries) ? baseState.entries.map((e) => ({ ...e })) : [];

  for (const op of queue || []) {
    if (!op) continue;
    if (op.kind === 'settings' && op.settings) {
      nextSettings = { ...nextSettings, ...op.settings };
    } else if (op.kind === 'upsert' && op.entry?.id) {
      const idx = nextEntries.findIndex((e) => e.id === op.entry.id);
      if (idx >= 0) nextEntries[idx] = { ...op.entry };
      else nextEntries.push({ ...op.entry });
    } else if (op.kind === 'delete' && op.id) {
      nextEntries = nextEntries.filter((e) => e.id !== op.id);
    }
  }

  return { settings: nextSettings, entries: nextEntries };
}

/**
 * Detecta falhas prováveis de conectividade/offline para enfileirar em vez de descartar.
 */
export function isLikelyNetworkError(err) {
  if (typeof globalThis.navigator !== 'undefined' && globalThis.navigator.onLine === false) {
    return true;
  }
  const msg = String(err?.message || err || '').toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|offline|timeout|fetch/i.test(msg);
}

export function loadUserCache(userId, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(`${STORAGE_KEYS.CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveUserCache(userId, state, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !userId || !state) return;
  try {
    storage.setItem(
      `${STORAGE_KEYS.CACHE_PREFIX}${userId}`,
      JSON.stringify({ settings: state.settings, entries: state.entries || [], updatedAt: Date.now() })
    );
  } catch { /* ignore quota error */ }
}

export function loadSyncQueue(userId, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !userId) return [];
  try {
    const raw = storage.getItem(`${STORAGE_KEYS.QUEUE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSyncQueue(userId, queue, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !userId) return;
  try {
    if (!queue || queue.length === 0) {
      storage.removeItem(`${STORAGE_KEYS.QUEUE_PREFIX}${userId}`);
    } else {
      storage.setItem(`${STORAGE_KEYS.QUEUE_PREFIX}${userId}`, JSON.stringify(queue));
    }
  } catch { /* ignore quota error */ }
}

export function hasCompletedOnboarding(userId, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !userId) return false;
  try {
    return storage.getItem(`${STORAGE_KEYS.ONBOARDING_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(userId, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !userId) return;
  try {
    storage.setItem(`${STORAGE_KEYS.ONBOARDING_PREFIX}${userId}`, '1');
  } catch { /* ignore */ }
}
