export const SUPABASE_URL = 'https://opctsxkugbljvghcgnvj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_nClSbvyd31jCHu1qpz4t-w_tUJ0RzUh';

export const STORAGE_KEYS = {
  THEME: 'saldohoras_theme',
  HOLIDAY_UF: 'saldohoras_holiday_uf',
  HOLIDAY_CACHE_PREFIX: 'saldohoras_holidays_v2_'
};

export const BRAZIL_UFS = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' }
];

export const ENTRY_CATEGORIES = {
  holiday: { label: 'Feriado Trabalhado', type: 'credit' },
  overtime: { label: 'Hora Extra / Plantão', type: 'credit' },
  time_off: { label: 'Folga Compensatória', type: 'debit' },
  adjustment: { label: 'Ajuste de Saldo', type: 'both' },
  manual: { label: 'Manual / Outros', type: 'both' }
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Retorna a data local no formato YYYY-MM-DD (imune ao deslocamento UTC após 21h BRT).
 */
export function getLocalDateISO(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToISO(isoDate, days) {
  if (!isValidISODate(isoDate)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + Number(days || 0));
  return getLocalDateISO(dt);
}

export function isValidISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatDateBR(isoDate) {
  if (!isValidISODate(isoDate)) return '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function getWeekdayShortBR(isoDate) {
  if (!isValidISODate(isoDate)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][day];
}

export function isWeekendISO(isoDate) {
  if (!isValidISODate(isoDate)) return false;
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

/**
 * Neutraliza prefixos de fórmula em planilhas para prevenir CSV/Formula Injection.
 */
export function sanitizeCsvCell(str) {
  const raw = String(str ?? '').replace(/\r?\n/g, ' ').trim();
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Remove emojis/caracteres fora do suporte WinAnsi da fonte padrão Helvetica do jsPDF.
 */
export function sanitizePdfText(str) {
  return String(str ?? '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
