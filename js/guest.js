import { STORAGE_KEYS, addDaysToISO, generateUUID, getLocalDateISO } from './config.js';
import { createDefaultSettings } from './db.js';
import { applyMultiplierToMinutes, computeChronologicalAndFIFO } from './time.js';

function getSafeStorage(storageOverride) {
  if (storageOverride) return storageOverride;
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
}

export function isGuestModeActive(storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEYS.GUEST_ACTIVE) === '1';
  } catch {
    return false;
  }
}

export function setGuestModeActive(active, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage) return;
  try {
    if (active) storage.setItem(STORAGE_KEYS.GUEST_ACTIVE, '1');
    else storage.removeItem(STORAGE_KEYS.GUEST_ACTIVE);
  } catch { /* ignore */ }
}

export function isGuestBannerDismissed(storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEYS.GUEST_BANNER_DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function setGuestBannerDismissed(dismissed, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage) return;
  try {
    if (dismissed) storage.setItem(STORAGE_KEYS.GUEST_BANNER_DISMISSED, '1');
    else storage.removeItem(STORAGE_KEYS.GUEST_BANNER_DISMISSED);
  } catch { /* ignore */ }
}

export function loadGuestState(storageOverride) {
  const storage = getSafeStorage(storageOverride);
  const fallback = { settings: createDefaultSettings('Modo Teste'), entries: [] };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(STORAGE_KEYS.GUEST_STATE);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      settings: parsed?.settings ? { ...createDefaultSettings('Modo Teste'), ...parsed.settings } : fallback.settings,
      entries: Array.isArray(parsed?.entries) ? parsed.entries : []
    };
  } catch {
    return fallback;
  }
}

export function saveGuestState(state, storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage || !state) return;
  try {
    storage.setItem(
      STORAGE_KEYS.GUEST_STATE,
      JSON.stringify({
        settings: state.settings || createDefaultSettings('Modo Teste'),
        entries: Array.isArray(state.entries) ? state.entries : [],
        updatedAt: Date.now()
      })
    );
  } catch { /* ignore */ }
}

export function clearGuestState(storageOverride) {
  const storage = getSafeStorage(storageOverride);
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEYS.GUEST_STATE);
    storage.removeItem(STORAGE_KEYS.GUEST_ACTIVE);
    storage.removeItem(STORAGE_KEYS.GUEST_BANNER_DISMISSED);
  } catch { /* ignore */ }
}

/**
 * Gera 5 lançamentos realistas de exemplo marcados com isDemo: true.
 */
export function createDemoEntries(settings = createDefaultSettings(), baseDateISO = getLocalDateISO()) {
  const daily = Number(settings?.dailyMinutes) || 480;
  const otMult = Number(settings?.overtimeMultiplier) || 1.5;
  const holMult = Number(settings?.holidayMultiplier) || 1.4;
  const expDays = Number(settings?.expiryDays) || 180;

  const dPastExpiring = addDaysToISO(baseDateISO, -(expDays - 14));
  const dPastExtra = addDaysToISO(baseDateISO, -22);
  const dPastHol = addDaysToISO(baseDateISO, -10);
  const dPastLeave = addDaysToISO(baseDateISO, -5);
  const dPlanned = addDaysToISO(baseDateISO, 12);

  return [
    {
      id: generateUUID(),
      date: dPastExpiring,
      title: 'Plantão de implantação (exemplo)',
      type: 'credit',
      minutes: applyMultiplierToMinutes(180, otMult),
      workedMinutes: 180,
      multiplier: otMult,
      category: 'overtime',
      status: 'realized',
      expiry: addDaysToISO(dPastExpiring, expDays),
      notes: 'Exemplo demonstrativo',
      isDemo: true,
      createdAt: new Date().toISOString()
    },
    {
      id: generateUUID(),
      date: dPastExtra,
      title: 'Hora extra fechamento mensal (exemplo)',
      type: 'credit',
      minutes: applyMultiplierToMinutes(120, otMult),
      workedMinutes: 120,
      multiplier: otMult,
      category: 'overtime',
      status: 'realized',
      expiry: addDaysToISO(dPastExtra, expDays),
      notes: 'Exemplo demonstrativo',
      isDemo: true,
      createdAt: new Date().toISOString()
    },
    {
      id: generateUUID(),
      date: dPastHol,
      title: 'Feriado trabalhado (exemplo)',
      type: 'credit',
      minutes: applyMultiplierToMinutes(daily, holMult),
      workedMinutes: daily,
      multiplier: holMult,
      category: 'holiday',
      status: 'realized',
      expiry: addDaysToISO(dPastHol, expDays),
      notes: 'Exemplo demonstrativo',
      isDemo: true,
      createdAt: new Date().toISOString()
    },
    {
      id: generateUUID(),
      date: dPastLeave,
      title: 'Saída antecipada (exemplo)',
      type: 'debit',
      minutes: Math.round(daily / 2),
      workedMinutes: Math.round(daily / 2),
      multiplier: 1.0,
      category: 'time_off',
      status: 'realized',
      expiry: '',
      notes: 'Exemplo demonstrativo',
      isDemo: true,
      createdAt: new Date().toISOString()
    },
    {
      id: generateUUID(),
      date: dPlanned,
      title: 'Folga planejada (exemplo)',
      type: 'debit',
      minutes: daily,
      workedMinutes: daily,
      multiplier: 1.0,
      category: 'time_off',
      status: 'planned',
      expiry: '',
      notes: 'Exemplo demonstrativo',
      isDemo: true,
      createdAt: new Date().toISOString()
    }
  ];
}

export function partitionGuestEntries(entriesList = []) {
  const realEntries = [];
  const demoEntries = [];
  for (const item of entriesList || []) {
    if (!item) continue;
    if (item.isDemo) demoEntries.push(item);
    else realEntries.push(item);
  }
  return {
    realEntries,
    demoEntries,
    hasRealEntries: realEntries.length > 0,
    hasOnlyDemo: demoEntries.length > 0 && realEntries.length === 0
  };
}

/**
 * Decide qual fluxo de migração executar quando um usuário no modo teste entra/cria conta na nuvem.
 */
export function computeGuestMigrationPlan({ guestEntries = [], cloudEntries = [], isNewAccount = false } = {}) {
  const { realEntries, hasRealEntries } = partitionGuestEntries(guestEntries);
  if (!hasRealEntries) {
    return { action: 'silent', realEntries: [], balanceMinutes: 0 };
  }
  const { summary } = computeChronologicalAndFIFO(realEntries);
  if (isNewAccount || !Array.isArray(cloudEntries) || cloudEntries.length === 0) {
    return {
      action: 'new_account_prompt',
      realEntries,
      balanceMinutes: summary.projectedMinutes
    };
  }
  return {
    action: 'merge_prompt',
    realEntries,
    cloudCount: cloudEntries.length,
    balanceMinutes: summary.projectedMinutes
  };
}

/**
 * Mescla lançamentos locais do modo teste com a nuvem evitando duplicatas óbvias.
 */
export function mergeGuestWithCloudEntries(cloudEntries = [], realGuestEntries = []) {
  const existingKeys = new Set(
    (cloudEntries || []).map(
      (e) => `${e.date}|${e.type}|${e.minutes}|${String(e.title || '').trim().toLowerCase()}`
    )
  );
  const toInsert = [];
  for (const g of realGuestEntries || []) {
    const key = `${g.date}|${g.type}|${g.minutes}|${String(g.title || '').trim().toLowerCase()}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      const { isDemo: _drop, ...clean } = g;
      toInsert.push({ ...clean, id: clean.id || generateUUID() });
    }
  }
  return toInsert;
}
