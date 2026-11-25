import { STORAGE_KEYS, addDaysToISO, getLocalDateISO } from './config.js';
import { isHolidayEntry } from './time.js';

/**
 * Calcula o Domingo de Páscoa para qualquer ano gregoriano (Algoritmo de Meeus/Jones/Butcher).
 */
export function computeEasterISO(year) {
  const y = Number(year);
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const STATE_HOLIDAYS_BY_UF = {
  AC: [
    { mmdd: '01-23', name: 'Dia do Evangélico (AC)' },
    { mmdd: '03-08', name: 'Dia Internacional da Mulher (AC)' },
    { mmdd: '06-15', name: 'Aniversário do Estado do Acre' },
    { mmdd: '09-05', name: 'Dia da Amazônia (AC)' },
    { mmdd: '11-17', name: 'Tratado de Petrópolis (AC)' }
  ],
  AL: [
    { mmdd: '06-24', name: 'São João (AL)' },
    { mmdd: '06-29', name: 'São Pedro (AL)' },
    { mmdd: '09-16', name: 'Emancipação Política de Alagoas' }
  ],
  AP: [
    { mmdd: '03-19', name: 'Dia de São José (AP)' },
    { mmdd: '09-13', name: 'Criação do Território Federal do Amapá' }
  ],
  AM: [
    { mmdd: '09-05', name: 'Elevação do Amazonas à Província' },
    { mmdd: '12-08', name: 'Nossa Senhora da Conceição (AM)' }
  ],
  BA: [
    { mmdd: '07-02', name: 'Independência da Bahia' }
  ],
  CE: [
    { mmdd: '03-19', name: 'Dia de São José (CE)' },
    { mmdd: '03-25', name: 'Data Magna do Ceará (Abolição)' }
  ],
  DF: [
    { mmdd: '04-21', name: 'Fundação de Brasília (DF)' },
    { mmdd: '11-30', name: 'Dia do Evangélico (DF)' }
  ],
  ES: [
    { mmdd: '04-12', name: 'Nossa Senhora da Penha (ES — ref.)', optional: true }
  ],
  GO: [
    { mmdd: '07-26', name: 'Fundação da Cidade de Goiás (GO)', optional: true },
    { mmdd: '10-24', name: 'Pedra Fundamental de Goiânia (GO)', optional: true }
  ],
  MA: [
    { mmdd: '07-28', name: 'Adesão do Maranhão à Independência' }
  ],
  MT: [],
  MS: [
    { mmdd: '10-11', name: 'Criação do Estado de Mato Grosso do Sul' }
  ],
  MG: [
    { mmdd: '04-21', name: 'Data Magna de Minas Gerais' }
  ],
  PA: [
    { mmdd: '08-15', name: 'Adesão do Grão-Pará à Independência' }
  ],
  PB: [
    { mmdd: '08-05', name: 'Fundação do Estado da Paraíba' }
  ],
  PR: [
    { mmdd: '12-19', name: 'Emancipação Política do Paraná' }
  ],
  PE: [
    { mmdd: '03-06', name: 'Revolução Pernambucana de 1817 (Data Magna)' },
    { mmdd: '06-24', name: 'São João (PE)', optional: true }
  ],
  PI: [
    { mmdd: '10-19', name: 'Dia do Piauí' }
  ],
  RJ: [
    { mmdd: '04-23', name: 'Dia de São Jorge (RJ)' },
    { mmdd: '10-19', name: 'Dia do Comércio (RJ)', optional: true }
  ],
  RN: [
    { mmdd: '10-03', name: 'Mártires de Cunhaú e Uruaçu (RN)' }
  ],
  RS: [
    { mmdd: '09-20', name: 'Dia do Gaúcho — Revolução Farroupilha (RS)' }
  ],
  RO: [
    { mmdd: '01-04', name: 'Criação do Estado de Rondônia' },
    { mmdd: '06-18', name: 'Dia do Evangélico (RO)' }
  ],
  RR: [
    { mmdd: '10-05', name: 'Criação do Estado de Roraima' }
  ],
  SC: [
    { mmdd: '08-11', name: 'Dia de Santa Catarina (data ref.)', optional: true }
  ],
  SP: [
    { mmdd: '07-09', name: 'Revolução Constitucionalista de 1932 (SP)' }
  ],
  SE: [
    { mmdd: '07-08', name: 'Emancipação Política de Sergipe' }
  ],
  TO: [
    { mmdd: '09-08', name: 'Nossa Senhora da Natividade (TO)' },
    { mmdd: '10-05', name: 'Criação do Estado do Tocantins' }
  ]
};

/**
 * Gera calendário offline completo (Nacionais + Móveis + Estaduais da UF) para qualquer ano.
 */
export function computeOfflineHolidays(year, stateUf = 'SP') {
  const y = Number(year);
  const easterISO = computeEasterISO(y);

  const national = [
    { date: `${y}-01-01`, name: 'Confraternização Universal', scope: 'Nacional' },
    { date: addDaysToISO(easterISO, -47), name: 'Carnaval', scope: 'Nacional' },
    { date: addDaysToISO(easterISO, -2), name: 'Paixão de Cristo (Sexta-Feira Santa)', scope: 'Nacional' },
    { date: easterISO, name: 'Páscoa', scope: 'Nacional' },
    { date: `${y}-04-21`, name: 'Tiradentes', scope: 'Nacional' },
    { date: `${y}-05-01`, name: 'Dia do Trabalho', scope: 'Nacional' },
    { date: addDaysToISO(easterISO, 60), name: 'Corpus Christi', scope: 'Nacional' },
    { date: `${y}-09-07`, name: 'Independência do Brasil', scope: 'Nacional' },
    { date: `${y}-10-12`, name: 'Nossa Senhora Aparecida', scope: 'Nacional' },
    { date: `${y}-11-02`, name: 'Finados', scope: 'Nacional' },
    { date: `${y}-11-15`, name: 'Proclamação da República', scope: 'Nacional' },
    { date: `${y}-11-20`, name: 'Dia da Consciência Negra', scope: 'Nacional' },
    { date: `${y}-12-25`, name: 'Natal', scope: 'Nacional' }
  ];

  const uf = String(stateUf || 'NONE').toUpperCase();
  const stateItems = uf !== 'NONE' && STATE_HOLIDAYS_BY_UF[uf]
    ? STATE_HOLIDAYS_BY_UF[uf].map((sh) => ({
        date: `${y}-${sh.mmdd}`,
        name: sh.name,
        scope: sh.optional ? `Facultativo (${uf})` : uf
      }))
    : [];

  return mergeHolidayLists(national, stateItems);
}

function mergeHolidayLists(primaryNational, secondaryItems) {
  const byDate = new Map();
  for (const h of primaryNational) {
    byDate.set(h.date, h);
  }
  for (const h of secondaryItems) {
    const existing = byDate.get(h.date);
    if (!existing) {
      byDate.set(h.date, h);
    } else if (existing.scope === 'Nacional' && h.scope !== 'Nacional' && !existing.name.includes(h.name)) {
      byDate.set(h.date, {
        ...existing,
        name: `${existing.name} / ${h.name}`
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function readHolidayCache(year) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${STORAGE_KEYS.HOLIDAY_CACHE_PREFIX}${year}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    // Cache válido por 14 dias
    if (Date.now() - Number(parsed.ts || 0) > 14 * 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHolidayCache(year, items, updatedAt) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      `${STORAGE_KEYS.HOLIDAY_CACHE_PREFIX}${year}`,
      JSON.stringify({ ts: Date.now(), updatedAt, items })
    );
  } catch {
    // Ignora caso localStorage esteja indisponível
  }
}

/**
 * Busca feriados nacionais na BrasilAPI (com cache e timeout curto) combinando com feriados móveis e estaduais.
 * Em caso de falha de rede, retorna cálculo algorítmico local sem lançar erro.
 */
export async function fetchHolidaysForYear(year, stateUf = 'SP', forceRefresh = false) {
  const y = Number(year);
  const uf = String(stateUf || 'NONE').toUpperCase();
  const offlineAll = computeOfflineHolidays(y, uf);
  const offlineStateOnly = offlineAll.filter((h) => h.scope !== 'Nacional');

  let nationalItems = null;
  let sourceLabel = 'Calendário Algorítmico Local';
  let updatedAt = new Date().toLocaleString('pt-BR');

  if (!forceRefresh) {
    const cached = readHolidayCache(y);
    if (cached) {
      nationalItems = cached.items;
      sourceLabel = 'BrasilAPI (Cache local)';
      updatedAt = cached.updatedAt || updatedAt;
    }
  }

  if (!nationalItems && typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${y}`, {
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const apiData = await resp.json();
      if (Array.isArray(apiData) && apiData.length > 0) {
        const apiNational = apiData
          .filter((item) => item && typeof item.date === 'string' && typeof item.name === 'string')
          .map((item) => ({
            date: item.date,
            name: item.name,
            scope: 'Nacional'
          }));
        // Garante que Corpus Christi / Páscoa / Consciência Negra constem caso alguma resposta omita
        const offlineNational = offlineAll.filter((h) => h.scope === 'Nacional');
        nationalItems = mergeHolidayLists(apiNational, offlineNational);
        updatedAt = new Date().toLocaleString('pt-BR');
        writeHolidayCache(y, nationalItems, updatedAt);
        sourceLabel = 'BrasilAPI';
      }
    } catch {
      sourceLabel = 'Calendário Algorítmico Local (Fallback)';
    } finally {
      clearTimeout(timer);
    }
  }

  const finalList = nationalItems
    ? mergeHolidayLists(nationalItems, offlineStateOnly)
    : offlineAll;

  const todayISO = getLocalDateISO();
  const [ty, tm, td] = todayISO.split('-').map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);

  const items = finalList.map((h) => {
    const [hy, hm, hd] = h.date.split('-').map(Number);
    const daysDiff = Math.round((Date.UTC(hy, hm - 1, hd) - todayUtc) / 86400000);
    return {
      ...h,
      daysDiff,
      isPast: daysDiff < 0,
      isToday: daysDiff === 0
    };
  });

  return { year: y, stateUf: uf, sourceLabel, updatedAt, items };
}

/**
 * Verifica se o feriado já está presente no extrato (evita duplicidades e nunca apaga registros).
 */
export function isHolidayAlreadyInEntries(entries, dateStr, nameStr) {
  const baseName = (nameStr || '').split('(')[0].trim().toLowerCase();
  return (entries || []).some((e) => {
    if (e.date !== dateStr || e.type !== 'credit') return false;
    if (isHolidayEntry(e)) return true;
    return baseName && (e.title || '').toLowerCase().includes(baseName);
  });
}

/**
 * Detecta oportunidade de "emendar feriado" (Terça -> ponte na Segunda; Quinta -> ponte na Sexta).
 */
export function getHolidayBridgeOpportunity(holiday, entries = []) {
  if (!holiday?.date || !/^\d{4}-\d{2}-\d{2}$/.test(holiday.date)) return null;
  const [y, m, d] = holiday.date.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay();

  let bridgeDate = null;
  let bridgeLabel = '';
  if (weekday === 2) {
    bridgeDate = addDaysToISO(holiday.date, -1);
    bridgeLabel = 'Ponte na Segunda';
  } else if (weekday === 4) {
    bridgeDate = addDaysToISO(holiday.date, 1);
    bridgeLabel = 'Ponte na Sexta';
  } else {
    return null;
  }

  const alreadyScheduled = (entries || []).some(
    (e) => e.date === bridgeDate && e.type === 'debit'
  );

  return {
    holidayDate: holiday.date,
    holidayName: holiday.name,
    bridgeDate,
    bridgeLabel,
    alreadyScheduled
  };
}
