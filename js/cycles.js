import { generateUUID, getLocalDateISO } from './config.js';
import { getActiveRuleSummary } from './rules-catalog.js';
import { computeChronologicalAndFIFO, formatHHMM } from './time.js';

/**
 * Calcula o snapshot de arquivamento do ciclo atual e os lançamentos de abertura do próximo ciclo.
 * Preserva as sobras exatas dos créditos não compensados e suas datas de vencimento originais.
 */
export function computeCycleCarryOver(entries, settings, { mode = 'carry', cycleName = '', closingDate = getLocalDateISO() } = {}) {
  const { chrono, remainingMap, summary } = computeChronologicalAndFIFO(entries || [], closingDate);
  const firstDate = chrono.length > 0 ? chrono[0].date : closingDate;
  const ruleLabel = getActiveRuleSummary(settings);
  const year = String(closingDate || getLocalDateISO()).slice(0, 4);

  const archivedCycle = {
    id: generateUUID(),
    name: String(cycleName || '').trim() || `Ciclo ${year}`,
    startedAt: firstDate,
    closedAt: closingDate,
    ruleSummary: ruleLabel,
    settingsSnapshot: {
      dailyMinutes: Number(settings?.dailyMinutes) || 480,
      overtimeMultiplier: Number(settings?.overtimeMultiplier) || 1.5,
      holidayMultiplier: Number(settings?.holidayMultiplier) || 1.4,
      expiryDays: Number(settings?.expiryDays) || 180,
      stateUf: settings?.stateUf || 'SP',
      unionMode: settings?.unionMode || 'sector',
      unionCode: settings?.unionCode || 'sindpd_sp',
      companySector: settings?.companySector || 'tecnologia'
    },
    finalBalanceMinutes: summary.realizedMinutes,
    projectedBalanceMinutes: summary.projectedMinutes,
    entriesCount: chrono.length,
    entries: chrono.map((item) => ({
      id: item.id,
      date: item.date,
      title: item.title,
      type: item.type,
      minutes: item.minutes,
      workedMinutes: item.workedMinutes,
      multiplier: item.multiplier,
      category: item.category,
      status: item.status,
      expiry: item.expiry || '',
      notes: item.notes || '',
      runningMinutes: item.runningMinutes
    }))
  };

  if (mode === 'zero') {
    return { archivedCycle, nextEntries: [] };
  }

  const nextEntries = [];
  const openCredits = chrono.filter((item) => item.type === 'credit' && (remainingMap.get(item.id) ?? 0) > 0);
  const openCreditsSum = openCredits.reduce((acc, item) => acc + (remainingMap.get(item.id) ?? 0), 0);

  if (summary.projectedMinutes > 0 && openCreditsSum > 0) {
    for (const credit of openCredits) {
      const rem = remainingMap.get(credit.id) ?? 0;
      if (rem <= 0) continue;
      nextEntries.push({
        id: generateUUID(),
        date: credit.date,
        title: credit.title,
        type: 'credit',
        minutes: rem,
        workedMinutes: rem,
        multiplier: 1.0,
        category: credit.category || 'adjustment',
        status: credit.status === 'planned' ? 'planned' : 'realized',
        expiry: credit.expiry || '',
        notes: 'Do ciclo anterior',
        createdAt: new Date().toISOString()
      });
    }
  } else if (summary.projectedMinutes < 0) {
    const absMins = Math.abs(summary.projectedMinutes);
    nextEntries.push({
      id: generateUUID(),
      date: closingDate,
      title: `Saldo anterior (${formatHHMM(summary.projectedMinutes, true)})`,
      type: 'debit',
      minutes: absMins,
      workedMinutes: absMins,
      multiplier: 1.0,
      category: 'adjustment',
      status: 'realized',
      expiry: '',
      notes: 'Do ciclo anterior',
      createdAt: new Date().toISOString()
    });
  }

  return { archivedCycle, nextEntries };
}

export function loadArchivedCycles(userId, storage = globalThis.localStorage) {
  if (!userId || !storage) return [];
  try {
    const raw = storage.getItem(`saldohoras_cycles_v1_${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveArchivedCycles(userId, cycles, storage = globalThis.localStorage) {
  if (!userId || !storage) return;
  try {
    storage.setItem(`saldohoras_cycles_v1_${userId}`, JSON.stringify(Array.isArray(cycles) ? cycles : []));
  } catch {
    // ignore quota errors
  }
}

export function mergeArchivedCycles(localCycles = [], cloudCycles = []) {
  const byId = new Map();
  for (const item of [...(cloudCycles || []), ...(localCycles || [])]) {
    if (item && item.id) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));
}
