import {
  ENTRY_CATEGORIES,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  generateUUID,
  isValidISODate,
  isValidUUID
} from './config.js';
import { minutesToDecimalHours } from './time.js';

export const supabaseClient = globalThis.window?.supabase
  ? globalThis.window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export function createDefaultSettings(userName = '') {
  return {
    userName,
    dailyMinutes: 480,
    expiryDays: 180,
    managerEmail: '',
    managerPhone: '',
    unionMode: 'sector',
    unionCode: 'sindpd_sp',
    companySector: 'tecnologia',
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.4,
    stateUf: 'SP'
  };
}

export function normalizeSettingsRow(row, fallbackName = '') {
  if (!row) return createDefaultSettings(fallbackName);
  const mins = (row.daily_minutes !== null && row.daily_minutes !== undefined)
    ? Math.round(Number(row.daily_minutes))
    : Math.round((Number(row.daily_hours) || 8) * 60);

  return {
    userName: row.user_name || fallbackName,
    dailyMinutes: mins > 0 ? mins : 480,
    expiryDays: Number(row.expiry_days) || 180,
    managerEmail: row.manager_email || '',
    managerPhone: row.manager_phone || '',
    unionMode: ['union', 'sector', 'custom'].includes(row.union_mode) ? row.union_mode : 'sector',
    unionCode: row.union_code || 'sindpd_sp',
    companySector: row.company_sector || 'tecnologia',
    overtimeMultiplier: Number(row.overtime_multiplier) > 0 ? Number(row.overtime_multiplier) : 1.5,
    holidayMultiplier: Number(row.holiday_multiplier) > 0 ? Number(row.holiday_multiplier) : 1.4,
    stateUf: (row.state_uf || 'SP').toUpperCase()
  };
}

export function normalizeEntryRow(row) {
  const hasMinutes = row.minutes !== null && row.minutes !== undefined && Number.isFinite(Number(row.minutes));
  const minutes = hasMinutes
    ? Math.max(0, Math.round(Number(row.minutes)))
    : Math.max(0, Math.round((Number(row.hours) || 0) * 60));

  const workedMinutes = (row.worked_minutes !== null && row.worked_minutes !== undefined && Number.isFinite(Number(row.worked_minutes)))
    ? Math.max(0, Math.round(Number(row.worked_minutes)))
    : minutes;

  const validCategory = ENTRY_CATEGORIES[row.category] ? row.category : 'manual';

  return {
    id: row.id,
    date: row.date,
    title: row.title || '',
    type: row.type === 'debit' ? 'debit' : 'credit',
    minutes,
    workedMinutes,
    multiplier: Number(row.multiplier) > 0 ? Number(row.multiplier) : 1.0,
    category: validCategory,
    status: row.status === 'planned' ? 'planned' : 'realized',
    expiry: row.expiry || '',
    notes: row.notes || '',
    createdAt: row.created_at || ''
  };
}

export function buildParamsPayload(settings, userId) {
  const dailyMinutes = Math.max(60, Math.round(Number(settings.dailyMinutes) || 480));
  return {
    user_id: userId,
    user_name: settings.userName || '',
    daily_hours: minutesToDecimalHours(dailyMinutes),
    daily_minutes: dailyMinutes,
    expiry_days: Math.max(15, Math.min(730, parseInt(settings.expiryDays, 10) || 180)),
    manager_email: settings.managerEmail || '',
    manager_phone: String(settings.managerPhone || '').replace(/\D/g, ''),
    union_mode: ['union', 'sector', 'custom'].includes(settings.unionMode) ? settings.unionMode : 'sector',
    union_code: settings.unionCode || 'sindpd_sp',
    company_sector: settings.companySector || 'tecnologia',
    overtime_multiplier: Number(settings.overtimeMultiplier) || 1.0,
    holiday_multiplier: Number(settings.holidayMultiplier) || 1.0,
    state_uf: (settings.stateUf || 'SP').toUpperCase()
  };
}

export function buildEntryPayload(entry, userId) {
  const minutes = Math.max(1, Math.round(Number(entry.minutes) || 0));
  const workedMinutes = Math.max(1, Math.round(Number(entry.workedMinutes ?? minutes)));
  return {
    id: isValidUUID(entry.id) ? entry.id : generateUUID(),
    user_id: userId,
    date: entry.date,
    title: String(entry.title || '').trim(),
    type: entry.type === 'debit' ? 'debit' : 'credit',
    hours: minutesToDecimalHours(minutes),
    minutes,
    worked_minutes: workedMinutes,
    multiplier: Number(entry.multiplier) > 0 ? Number(entry.multiplier) : 1.0,
    category: ENTRY_CATEGORIES[entry.category] ? entry.category : 'manual',
    status: entry.status === 'planned' ? 'planned' : 'realized',
    expiry: entry.type === 'credit' && isValidISODate(entry.expiry) ? entry.expiry : null,
    notes: String(entry.notes || '').trim()
  };
}

/**
 * Valida e normaliza uma lista de lançamentos vindos de backup JSON externo.
 */
export function validateAndNormalizeImportedEntries(rawList) {
  if (!Array.isArray(rawList)) {
    throw new Error('Estrutura de lançamentos inválida.');
  }

  const validEntries = [];
  let skippedCount = 0;

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') {
      skippedCount += 1;
      continue;
    }

    const date = typeof raw.date === 'string' ? raw.date.trim() : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const type = raw.type === 'credit' || raw.type === 'debit' ? raw.type : null;
    const status = raw.status === 'planned' ? 'planned' : (raw.status === 'realized' ? 'realized' : 'realized');

    let mins = null;
    if (raw.minutes !== undefined && raw.minutes !== null && Number.isFinite(Number(raw.minutes))) {
      mins = Math.round(Number(raw.minutes));
    } else if (raw.hours !== undefined && raw.hours !== null && Number.isFinite(Number(raw.hours))) {
      mins = Math.round(Number(raw.hours) * 60);
    }

    if (!isValidISODate(date) || !title || !type || !mins || mins <= 0) {
      skippedCount += 1;
      continue;
    }

    const id = isValidUUID(raw.id) ? raw.id : generateUUID();
    const expiry = type === 'credit' && isValidISODate(raw.expiry) ? raw.expiry : '';

    validEntries.push(normalizeEntryRow({
      id,
      date,
      title,
      type,
      minutes: mins,
      worked_minutes: raw.workedMinutes ?? raw.worked_minutes ?? mins,
      multiplier: raw.multiplier ?? 1.0,
      category: raw.category || 'manual',
      status,
      expiry,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      created_at: typeof raw.createdAt === 'string' ? raw.createdAt : (typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString())
    }));
  }

  return { validEntries, skippedCount };
}

function assertAuthenticatedUserId(userId) {
  if (!isValidUUID(userId)) {
    throw new Error('Sessão de usuário inválida ou não autenticada.');
  }
  return userId;
}

export async function loadUserDataFromCloud(user) {
  const userId = assertAuthenticatedUserId(user?.id);
  const metaName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Colaborador';

  const { data: paramsData, error: paramsErr } = await supabaseClient
    .from('bh_params')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (paramsErr) throw paramsErr;

  let settings;
  if (paramsData) {
    settings = normalizeSettingsRow(paramsData, metaName);
  } else {
    settings = createDefaultSettings(metaName);
    const { error: insertParamErr } = await supabaseClient
      .from('bh_params')
      .upsert(buildParamsPayload(settings, userId));
    if (insertParamErr) throw insertParamErr;
  }

  const { data: entriesData, error: entriesErr } = await supabaseClient
    .from('bh_entries')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (entriesErr) throw entriesErr;

  const entries = (entriesData || []).map(normalizeEntryRow);
  const archivedCycles = Array.isArray(paramsData?.archived_cycles) ? paramsData.archived_cycles : [];
  return { settings, entries, archivedCycles };
}

export async function saveArchivedCyclesToCloud(userId, archivedCycles, onStatus) {
  const uid = assertAuthenticatedUserId(userId);
  onStatus?.('saving');
  const { error } = await supabaseClient
    .from('bh_params')
    .update({ archived_cycles: Array.isArray(archivedCycles) ? archivedCycles : [] })
    .eq('user_id', uid);

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    const code = String(error.code || '');
    if (code === '42703' || code === 'PGRST204' || msg.includes('archived_cycles')) {
      onStatus?.('ok');
      return { cloudSynced: false, schemaPending: true };
    }
    onStatus?.('error');
    throw error;
  }
  onStatus?.('ok');
  return { cloudSynced: true, schemaPending: false };
}

export async function saveSettingsToCloud(userId, settings, onStatus) {
  const uid = assertAuthenticatedUserId(userId);
  onStatus?.('saving');
  const { error } = await supabaseClient
    .from('bh_params')
    .upsert(buildParamsPayload(settings, uid));

  if (error) {
    onStatus?.('error');
    throw error;
  }
  onStatus?.('ok');
}

export async function upsertEntryToCloud(userId, entry, onStatus) {
  const uid = assertAuthenticatedUserId(userId);
  onStatus?.('saving');
  const { error } = await supabaseClient
    .from('bh_entries')
    .upsert(buildEntryPayload(entry, uid));

  if (error) {
    onStatus?.('error');
    throw error;
  }
  onStatus?.('ok');
}

/**
 * Grava múltiplos lançamentos em uma única requisição HTTP (evita N+1).
 */
export async function upsertEntriesBatchToCloud(userId, entriesList, onStatus) {
  const uid = assertAuthenticatedUserId(userId);
  if (!entriesList || entriesList.length === 0) return;
  onStatus?.('saving');
  const payloads = entriesList.map((entry) => buildEntryPayload(entry, uid));
  const { error } = await supabaseClient
    .from('bh_entries')
    .upsert(payloads);

  if (error) {
    onStatus?.('error');
    throw error;
  }
  onStatus?.('ok');
}

export async function deleteEntryFromCloud(userId, entryId, onStatus) {
  const uid = assertAuthenticatedUserId(userId);
  onStatus?.('saving');
  const { error } = await supabaseClient
    .from('bh_entries')
    .delete()
    .eq('user_id', uid)
    .eq('id', entryId);

  if (error) {
    onStatus?.('error');
    throw error;
  }
  onStatus?.('ok');
}

export async function deleteAllEntriesFromCloud(userId, onStatus) {
  const uid = assertAuthenticatedUserId(userId);
  onStatus?.('saving');
  const { error } = await supabaseClient
    .from('bh_entries')
    .delete()
    .eq('user_id', uid);

  if (error) {
    onStatus?.('error');
    throw error;
  }
  onStatus?.('ok');
}

/**
 * Envia feedback ou relato de problema para o Supabase (permite usuário autenticado ou anônimo).
 */
export async function submitFeedbackToCloud({
  userId = null,
  type = 'sugestao',
  message = '',
  appVersion = '1.0.0',
  platform = 'desktop'
}) {
  const cleanMsg = String(message || '').trim();
  if (cleanMsg.length < 5) {
    throw new Error('Escreva pelo menos 5 caracteres para enviar seu feedback.');
  }
  if (!supabaseClient) {
    throw Object.assign(new Error('Serviço offline'), { code: 'OFFLINE' });
  }
  const normalizedType = type === 'problema' ? 'problema' : 'sugestao';
  const normalizedPlatform = platform === 'mobile' ? 'mobile' : 'desktop';
  const payload = {
    tipo: normalizedType,
    mensagem: cleanMsg.slice(0, 2000),
    versao_app: String(appVersion || '1.0.0').slice(0, 24),
    plataforma: normalizedPlatform
  };
  if (isValidUUID(userId)) {
    payload.user_id = userId;
  }

  const { error } = await supabaseClient
    .from('bh_feedback')
    .insert(payload);

  if (error) {
    throw error;
  }
  return { ok: true };
}
