import { formatDateBR, getLocalDateISO, isValidISODate } from './config.js';

const MAX_DURATION_MINUTES = 300 * 60;

/**
 * Converte entradas como "01:30", "8:00", "1.5", "1,5h", "8h30", "90m"
 * em minutos inteiros positivos. Retorna null se inválido.
 */
export function parseDurationToMinutes(rawValue, { min = 1, max = MAX_DURATION_MINUTES } = {}) {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) return null;
    const mins = Math.round(rawValue * 60);
    return mins >= min && mins <= max ? mins : null;
  }

  const text = String(rawValue).trim().toLowerCase();
  if (!text || text.startsWith('-')) return null;

  const colonMatch = text.match(/^(\d{1,4}):([0-5]\d)$/);
  if (colonMatch) {
    const total = Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
    return total >= min && total <= max ? total : null;
  }

  const hmMatch = text.match(/^(\d{1,4})\s*h(?:\s*([0-5]?\d)\s*m?)?$/);
  if (hmMatch) {
    const h = Number(hmMatch[1]);
    const m = hmMatch[2] ? Number(hmMatch[2]) : 0;
    if (m >= 60) return null;
    const total = h * 60 + m;
    return total >= min && total <= max ? total : null;
  }

  const minOnlyMatch = text.match(/^(\d{1,5})\s*(?:m|min|mins)$/);
  if (minOnlyMatch) {
    const total = Number(minOnlyMatch[1]);
    return total >= min && total <= max ? total : null;
  }

  const normalizedDecimal = text.replace(/h$/, '').replace(',', '.');
  if (/^\d+(?:\.\d+)?$/.test(normalizedDecimal)) {
    const num = Number(normalizedDecimal);
    if (!Number.isFinite(num)) return null;
    const total = Math.round(num * 60);
    return total >= min && total <= max ? total : null;
  }

  return null;
}

/**
 * Formata minutos inteiros em HH:MM (ex.: 90 -> "01:30", -90 -> "-01:30").
 */
export function formatHHMM(totalMinutes, forceSign = false) {
  const mins = Math.round(Number(totalMinutes) || 0);
  const absMins = Math.abs(mins);
  const hh = String(Math.floor(absMins / 60)).padStart(2, '0');
  const mm = String(absMins % 60).padStart(2, '0');
  let prefix = '';
  if (mins < 0) prefix = '-';
  else if (forceSign && mins > 0) prefix = '+';
  return `${prefix}${hh}:${mm}`;
}

export function minutesToDecimalHours(totalMinutes) {
  const mins = Math.round(Number(totalMinutes) || 0);
  return Number((mins / 60).toFixed(4));
}

export function formatDaysFromMinutes(totalMinutes, dailyMinutes = 480) {
  const base = Math.max(1, Math.round(Number(dailyMinutes) || 480));
  const days = Math.round(Number(totalMinutes) || 0) / base;
  return `${days.toFixed(1).replace('.', ',')} dias`;
}

export function applyMultiplierToMinutes(workedMinutes, multiplier = 1.0) {
  const base = Math.round(Number(workedMinutes) || 0);
  const mult = Number(multiplier);
  if (!Number.isFinite(mult) || mult <= 0) return base;
  return Math.round(base * mult);
}

/**
 * Ordenação cronológica determinística alinhada ao índice (user_id, date, created_at).
 */
export function compareEntriesChrono(a, b) {
  const dateDiff = (a.date || '').localeCompare(b.date || '');
  if (dateDiff !== 0) return dateDiff;

  const createdDiff = (a.createdAt || '').localeCompare(b.createdAt || '');
  if (createdDiff !== 0) return createdDiff;

  if (a.type !== b.type) {
    return a.type === 'credit' ? -1 : 1;
  }
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function getExpiryBadge(expiryIso, remainingMinutes = null, todayIso = getLocalDateISO(), totalMinutes = null) {
  if (!expiryIso || !isValidISODate(expiryIso)) {
    return {
      label: 'Sem vencimento',
      badgeClass: 'text-slate-400',
      isAlert: false,
      isExpired: false,
      daysRemaining: null
    };
  }

  if (remainingMinutes !== null && remainingMinutes <= 0) {
    return {
      label: `${formatDateBR(expiryIso)} (Compensado)`,
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70',
      isAlert: false,
      isExpired: false,
      daysRemaining: null
    };
  }

  const partialSuffix = (
    remainingMinutes !== null &&
    totalMinutes !== null &&
    remainingMinutes > 0 &&
    remainingMinutes < totalMinutes
  ) ? ` • resta ${formatHHMM(remainingMinutes)}` : '';

  const [ty, tm, td] = todayIso.split('-').map(Number);
  const [ey, em, ed] = expiryIso.split('-').map(Number);
  const diffDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86400000);

  if (diffDays < 0) {
    return {
      label: `${formatDateBR(expiryIso)} (Vencido${partialSuffix})`,
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
      isAlert: true,
      isExpired: true,
      daysRemaining: diffDays
    };
  }

  if (diffDays <= 60) {
    return {
      label: `${formatDateBR(expiryIso)} (${diffDays}d${partialSuffix})`,
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
      isAlert: true,
      isExpired: false,
      daysRemaining: diffDays
    };
  }

  return {
    label: partialSuffix ? `${formatDateBR(expiryIso)} (resta ${formatHHMM(remainingMinutes)})` : formatDateBR(expiryIso),
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    isAlert: false,
    isExpired: false,
    daysRemaining: diffDays
  };
}

/**
 * Calcula saldo acumulado em minutos inteiros e abate débitos via FIFO
 * nos créditos ordenados pelo vencimento mais próximo.
 */
export function computeChronologicalAndFIFO(entries, todayIso = getLocalDateISO()) {
  const sorted = [...entries].sort(compareEntriesChrono);
  let runningMinutes = 0;

  const chrono = sorted.map((item) => {
    const mins = Math.max(0, Math.round(Number(item.minutes ?? Math.round((Number(item.hours) || 0) * 60))));
    const worked = Math.max(0, Math.round(Number(item.workedMinutes ?? mins)));
    const deltaMinutes = item.type === 'credit' ? mins : -mins;
    runningMinutes += deltaMinutes;
    return {
      ...item,
      minutes: mins,
      workedMinutes: worked,
      multiplier: Number(item.multiplier) || 1.0,
      deltaMinutes,
      runningMinutes
    };
  });

  const totalDebitsMinutes = chrono
    .filter((e) => e.type === 'debit')
    .reduce((acc, e) => acc + e.minutes, 0);

  let debitPool = totalDebitsMinutes;
  const creditBuckets = chrono
    .filter((e) => e.type === 'credit')
    .map((e) => ({ ...e, remainingMinutes: e.minutes }))
    .sort((a, b) => {
      const expA = a.expiry || '9999-12-31';
      const expB = b.expiry || '9999-12-31';
      const cmp = expA.localeCompare(expB);
      return cmp !== 0 ? cmp : compareEntriesChrono(a, b);
    });

  const remainingMap = new Map();
  const urgentItems = [];

  for (const bucket of creditBuckets) {
    if (debitPool > 0) {
      const consumed = Math.min(bucket.remainingMinutes, debitPool);
      bucket.remainingMinutes -= consumed;
      debitPool -= consumed;
    }
    remainingMap.set(bucket.id, bucket.remainingMinutes);
    if (bucket.remainingMinutes <= 0 || !bucket.expiry) continue;

    const badge = getExpiryBadge(bucket.expiry, bucket.remainingMinutes, todayIso);
    if (badge.isAlert) {
      urgentItems.push({ ...bucket, diffDays: badge.daysRemaining, expiryBadge: badge });
    }
  }

  let realizedMinutes = 0;
  let projectedMinutes = 0;
  let creditsMinutes = 0;
  let creditsCount = 0;
  let debitsMinutes = 0;
  let debitsCount = 0;

  for (const item of chrono) {
    projectedMinutes += item.deltaMinutes;
    if (item.status === 'realized') realizedMinutes += item.deltaMinutes;
    if (item.type === 'credit') {
      creditsMinutes += item.minutes;
      creditsCount += 1;
    } else {
      debitsMinutes += item.minutes;
      debitsCount += 1;
    }
  }

  return {
    chrono,
    remainingMap,
    urgentItems,
    summary: {
      realizedMinutes,
      projectedMinutes,
      creditsMinutes,
      creditsCount,
      debitsMinutes,
      debitsCount
    }
  };
}

/**
 * Identifica se um lançamento deve ser tratado como feriado mesmo em registros legados.
 */
export function isHolidayEntry(entry) {
  if (!entry) return false;
  if (entry.category === 'holiday') return true;
  if (entry.type !== 'credit') return false;
  const title = (entry.title || '').toLowerCase();
  const notes = (entry.notes || '').toLowerCase();
  return /feriado|carnaval|tiradentes|finados|natal|confraterniza|corpus|independ|aparecida|república|consciência|sexta-feira santa|paixão de cristo|revolução/i.test(`${title} ${notes}`);
}
