import {
  BRAZIL_UFS,
  ENTRY_CATEGORIES,
  STORAGE_KEYS,
  addDaysToISO,
  escapeHtml,
  formatDateBR,
  generateUUID,
  getLocalDateISO,
  getWeekdayShortBR,
  isWeekendISO
} from './config.js';
import { fetchHolidaysForYear, isHolidayAlreadyInEntries } from './holidays.js';
import { SECTOR_CATALOG, UNION_CATALOG, findSectorByCode, findUnionByCode } from './rules-catalog.js';
import { applyMultiplierToMinutes, formatHHMM, parseDurationToMinutes } from './time.js';

/**
 * Executa operação assíncrona travando apenas o botão acionado.
 */
export async function runWithButtonLoading(btn, loadingHtml, fn) {
  if (!btn || btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  if (loadingHtml) btn.innerHTML = loadingHtml;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.dataset.busy = '0';
    btn.innerHTML = originalHtml;
    window.lucide?.createIcons();
  }
}

export function createModalManager(ctx) {
  let confirmResolver = null;
  let lastFocusedEl = null;

  let holidayYear = new Date().getFullYear();
  let holidayFilter = 'all'; // 'all' | 'upcoming' | 'available'
  let currentHolidayList = [];
  const selectedHolidayDates = new Set();

  // ==================== MODAL PRÓPRIO DE CONFIRMAÇÃO ====================
  function confirmDialog({
    title = 'Confirmar ação',
    message = 'Deseja continuar?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger'
  } = {}) {
    return new Promise((resolve) => {
      lastFocusedEl = document.activeElement;
      confirmResolver = resolve;

      const modal = document.getElementById('confirmModal');
      const okBtn = document.getElementById('confirmOkBtn');
      const cancelBtn = document.getElementById('confirmCancelBtn');
      const iconBox = document.getElementById('confirmIconBox');

      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      if (variant === 'danger') {
        okBtn.className = 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-rose-500';
        iconBox.className = 'w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0';
      } else if (variant === 'warning') {
        okBtn.className = 'px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-amber-500';
        iconBox.className = 'w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0';
      } else {
        okBtn.className = 'px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500';
        iconBox.className = 'w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0';
      }

      modal.classList.remove('hidden');
      window.lucide?.createIcons();
      cancelBtn.focus();
    });
  }

  function resolveConfirm(result) {
    const modal = document.getElementById('confirmModal');
    modal.classList.add('hidden');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
      lastFocusedEl = null;
    }
    if (confirmResolver) {
      const fn = confirmResolver;
      confirmResolver = null;
      fn(result);
    }
  }

  document.getElementById('confirmCancelBtn').addEventListener('click', () => resolveConfirm(false));
  document.getElementById('confirmOkBtn').addEventListener('click', () => resolveConfirm(true));
  document.getElementById('confirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'confirmModal') resolveConfirm(false);
  });

  // ==================== MODAL DE LANÇAMENTO (HH:MM) ====================
  function syncCategoryOptionsForType(type, preferredCategory = null) {
    const catSel = document.getElementById('entryCategory');
    const options = Object.entries(ENTRY_CATEGORIES)
      .filter(([, meta]) => meta.type === 'both' || meta.type === type)
      .map(([key, meta]) => `<option value="${key}">${escapeHtml(meta.label)}</option>`);
    catSel.innerHTML = options.join('');

    if (preferredCategory && Array.from(catSel.options).some((o) => o.value === preferredCategory)) {
      catSel.value = preferredCategory;
    } else {
      catSel.value = type === 'credit' ? 'overtime' : 'time_off';
    }
  }

  function getActiveMultiplierForForm() {
    const type = document.querySelector('input[name="entryType"]:checked').value;
    if (type !== 'credit') return 1.0;

    const settings = ctx.getSettings();
    const preset = document.getElementById('entryRulePreset').value;
    if (preset === 'union_holiday') return Number(settings.holidayMultiplier) || 1.0;
    if (preset === 'union_overtime') return Number(settings.overtimeMultiplier) || 1.0;
    if (preset === 'custom') {
      const val = parseFloat(document.getElementById('entryCustomMultiplier').value);
      return Number.isFinite(val) && val > 0 ? val : 1.0;
    }
    return parseFloat(preset) || 1.0;
  }

  function updateEntryComputedPreview() {
    const type = document.querySelector('input[name="entryType"]:checked').value;
    const multWrapper = document.getElementById('multiplierWrapper');
    const customBox = document.getElementById('customMultiplierBox');
    const preset = document.getElementById('entryRulePreset').value;

    multWrapper.classList.toggle('hidden', type !== 'credit');
    customBox.classList.toggle('hidden', type !== 'credit' || preset !== 'custom');
    customBox.classList.toggle('flex', type === 'credit' && preset === 'custom');

    const hh = Math.max(0, parseInt(document.getElementById('entryHoursPart').value, 10) || 0);
    const mm = Math.min(59, Math.max(0, parseInt(document.getElementById('entryMinutesPart').value, 10) || 0));
    const baseMins = hh * 60 + mm;

    if (type === 'credit') {
      const mult = getActiveMultiplierForForm();
      const creditedMins = applyMultiplierToMinutes(baseMins, mult);
      document.getElementById('entryComputedPreview').textContent =
        `Trabalhado ${formatHHMM(baseMins)} × ${mult}x = ${formatHHMM(creditedMins, true)}`;
    }
  }

  function openEntryModal(data = null, isEditing = false) {
    lastFocusedEl = document.activeElement;
    const settings = ctx.getSettings();

    document.getElementById('entryForm').reset();
    document.getElementById('entryId').value = isEditing && data?.id ? data.id : '';
    document.getElementById('entryModalTitle').textContent = isEditing ? 'Editar Lançamento' : 'Novo Lançamento';

    const today = getLocalDateISO();
    document.getElementById('entryDate').value = data?.date || today;
    document.getElementById('entryTitle').value = data?.title || '';
    document.getElementById('entryStatus').value = data?.status || 'realized';
    document.getElementById('entryNotes').value = data?.notes || '';

    const typeVal = data?.type || 'credit';
    document.querySelector(`input[name="entryType"][value="${typeVal}"]`).checked = true;
    document.getElementById('expiryFieldWrapper').classList.toggle('hidden', typeVal !== 'credit');

    syncCategoryOptionsForType(typeVal, data?.category || null);

    const totalMins = isEditing
      ? (Number(data?.workedMinutes) || Number(data?.minutes) || settings.dailyMinutes)
      : (Number(data?.minutes) || Number(settings.dailyMinutes) || 480);

    document.getElementById('entryHoursPart').value = Math.floor(totalMins / 60);
    document.getElementById('entryMinutesPart').value = totalMins % 60;

    const presetSel = document.getElementById('entryRulePreset');
    if (isEditing && data?.multiplier) {
      const mult = Number(data.multiplier);
      if (data.category === 'holiday' && mult === Number(settings.holidayMultiplier)) {
        presetSel.value = 'union_holiday';
      } else if (data.category === 'overtime' && mult === Number(settings.overtimeMultiplier)) {
        presetSel.value = 'union_overtime';
      } else if ([1, 1.5, 2].includes(mult)) {
        presetSel.value = String(mult);
      } else {
        presetSel.value = 'custom';
        document.getElementById('entryCustomMultiplier').value = mult;
      }
    } else {
      const cat = document.getElementById('entryCategory').value;
      if (cat === 'holiday') presetSel.value = 'union_holiday';
      else if (cat === 'overtime') presetSel.value = 'union_overtime';
      else presetSel.value = '1.0';
    }

    if (typeVal === 'credit') {
      document.getElementById('entryExpiry').value =
        data?.expiry || addDaysToISO(document.getElementById('entryDate').value, settings.expiryDays);
    } else {
      document.getElementById('entryExpiry').value = '';
    }

    updateEntryComputedPreview();
    document.getElementById('entryModal').classList.remove('hidden');
    window.lucide?.createIcons();
    document.getElementById('entryTitle').focus();
  }

  function closeEntryModal() {
    document.getElementById('entryModal').classList.add('hidden');
  }

  document.getElementById('closeEntryModalBtn').addEventListener('click', closeEntryModal);
  document.getElementById('cancelEntryModalBtn').addEventListener('click', closeEntryModal);
  document.getElementById('entryModal').addEventListener('click', (e) => {
    if (e.target.id === 'entryModal') closeEntryModal();
  });

  document.querySelectorAll('input[name="entryType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const type = document.querySelector('input[name="entryType"]:checked').value;
      const settings = ctx.getSettings();
      document.getElementById('expiryFieldWrapper').classList.toggle('hidden', type !== 'credit');
      syncCategoryOptionsForType(type);
      if (type === 'credit') {
        if (!document.getElementById('entryExpiry').value) {
          const baseDate = document.getElementById('entryDate').value || getLocalDateISO();
          document.getElementById('entryExpiry').value = addDaysToISO(baseDate, settings.expiryDays);
        }
        document.getElementById('entryRulePreset').value =
          document.getElementById('entryCategory').value === 'holiday' ? 'union_holiday' : 'union_overtime';
      }
      updateEntryComputedPreview();
    });
  });

  document.getElementById('entryCategory').addEventListener('change', (e) => {
    const cat = e.target.value;
    const type = document.querySelector('input[name="entryType"]:checked').value;
    if (type !== 'credit') return;
    const presetSel = document.getElementById('entryRulePreset');
    if (cat === 'holiday') presetSel.value = 'union_holiday';
    else if (cat === 'overtime') presetSel.value = 'union_overtime';
    else presetSel.value = '1.0';
    updateEntryComputedPreview();
  });

  document.getElementById('entryDate').addEventListener('change', () => {
    const type = document.querySelector('input[name="entryType"]:checked').value;
    const isNew = !document.getElementById('entryId').value;
    const settings = ctx.getSettings();
    if (type === 'credit' && isNew && document.getElementById('entryDate').value) {
      document.getElementById('entryExpiry').value =
        addDaysToISO(document.getElementById('entryDate').value, settings.expiryDays);
    }
  });

  document.getElementById('fillJourneyBtn').addEventListener('click', () => {
    const dMins = Number(ctx.getSettings().dailyMinutes) || 480;
    document.getElementById('entryHoursPart').value = Math.floor(dMins / 60);
    document.getElementById('entryMinutesPart').value = dMins % 60;
    updateEntryComputedPreview();
  });

  document.querySelectorAll('[data-quick-mins]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.dataset.quickMins) || 60;
      document.getElementById('entryHoursPart').value = Math.floor(mins / 60);
      document.getElementById('entryMinutesPart').value = mins % 60;
      updateEntryComputedPreview();
    });
  });

  document.getElementById('entryHoursPart').addEventListener('input', updateEntryComputedPreview);
  document.getElementById('entryMinutesPart').addEventListener('input', updateEntryComputedPreview);
  document.getElementById('entryRulePreset').addEventListener('change', updateEntryComputedPreview);
  document.getElementById('entryCustomMultiplier').addEventListener('input', updateEntryComputedPreview);

  document.getElementById('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('entrySubmitBtn');
    const hh = Math.max(0, parseInt(document.getElementById('entryHoursPart').value, 10) || 0);
    const mm = Math.min(59, Math.max(0, parseInt(document.getElementById('entryMinutesPart').value, 10) || 0));
    const workedMinutes = hh * 60 + mm;

    if (workedMinutes <= 0) {
      ctx.showToast('Informe uma duração maior que 00:00');
      return;
    }

    const existingId = document.getElementById('entryId').value;
    const existingItem = existingId ? ctx.getEntries().find((x) => x.id === existingId) : null;
    const id = existingId || generateUUID();
    const type = document.querySelector('input[name="entryType"]:checked').value;
    const category = document.getElementById('entryCategory').value || (type === 'debit' ? 'time_off' : 'manual');
    const multiplier = type === 'credit' ? getActiveMultiplierForForm() : 1.0;
    const finalMinutes = type === 'credit' ? applyMultiplierToMinutes(workedMinutes, multiplier) : workedMinutes;

    const entryObj = {
      id,
      type,
      date: document.getElementById('entryDate').value,
      minutes: finalMinutes,
      workedMinutes,
      multiplier,
      category,
      title: document.getElementById('entryTitle').value.trim(),
      status: document.getElementById('entryStatus').value,
      expiry: type === 'credit' ? document.getElementById('entryExpiry').value : '',
      notes: document.getElementById('entryNotes').value.trim(),
      createdAt: existingItem?.createdAt || new Date().toISOString()
    };

    await runWithButtonLoading(btn, 'Salvando...', async () => {
      const ok = await ctx.saveEntry(entryObj);
      if (ok) closeEntryModal();
    });
  });

  // ==================== MODAL DE PARÂMETROS & SINDICATO/RAMO ====================
  function populateSettingsSelects() {
    const unionSel = document.getElementById('settingUnionCode');
    unionSel.innerHTML = UNION_CATALOG.map(
      (u) => `<option value="${u.code}">${escapeHtml(u.name)}</option>`
    ).join('');

    const sectorSel = document.getElementById('settingCompanySector');
    sectorSel.innerHTML = SECTOR_CATALOG.map(
      (s) => `<option value="${s.code}">${escapeHtml(s.label)}</option>`
    ).join('');

    const ufOptions = BRAZIL_UFS.map(
      (u) => `<option value="${u.code}">${u.code} — ${escapeHtml(u.name)}</option>`
    ).join('');
    document.getElementById('settingStateUf').innerHTML = ufOptions;
    document.getElementById('holidayUfSelect').innerHTML = `<option value="NONE">Apenas Nacionais</option>${ufOptions}`;
  }

  function setSettingsUnionModeUI(mode) {
    const unionBtn = document.getElementById('unionModeBtn');
    const sectorBtn = document.getElementById('sectorModeBtn');
    const customBtn = document.getElementById('customModeBtn');
    const unionBox = document.getElementById('unionSelectBox');
    const sectorBox = document.getElementById('sectorSelectBox');

    const activeCls = 'px-2.5 py-1 rounded-md bg-indigo-600 text-white transition';
    const inactiveCls = 'px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition';

    unionBtn.className = mode === 'union' ? activeCls : inactiveCls;
    sectorBtn.className = mode === 'sector' ? activeCls : inactiveCls;
    customBtn.className = mode === 'custom' ? activeCls : inactiveCls;

    unionBox.classList.toggle('hidden', mode !== 'union');
    sectorBox.classList.toggle('hidden', mode !== 'sector');
  }

  function getActiveUnionModeFromUI() {
    if (!document.getElementById('unionSelectBox').classList.contains('hidden')) return 'union';
    if (!document.getElementById('sectorSelectBox').classList.contains('hidden')) return 'sector';
    return 'custom';
  }

  function applyPresetFromSelection(mode) {
    if (mode === 'union') {
      const code = document.getElementById('settingUnionCode').value;
      const union = findUnionByCode(code) || UNION_CATALOG[0];
      document.getElementById('settingCompanySector').value = union.sector || 'tecnologia';
      document.getElementById('settingDailyHHMM').value = formatHHMM(union.dailyMinutes);
      document.getElementById('settingOvertimeMult').value = union.overtimeMultiplier;
      document.getElementById('settingHolidayMult').value = union.holidayMultiplier;
      document.getElementById('settingExpiryDays').value = union.expiryDays;
      if (union.stateUf) document.getElementById('settingStateUf').value = union.stateUf;
      document.getElementById('unionRuleHint').textContent = union.note;
    } else if (mode === 'sector') {
      const code = document.getElementById('settingCompanySector').value;
      const sector = findSectorByCode(code) || SECTOR_CATALOG[0];
      document.getElementById('settingUnionCode').value = sector.unionCode;
      document.getElementById('settingDailyHHMM').value = formatHHMM(sector.dailyMinutes);
      document.getElementById('settingOvertimeMult').value = sector.overtimeMultiplier;
      document.getElementById('settingHolidayMult').value = sector.holidayMultiplier;
      document.getElementById('settingExpiryDays').value = sector.expiryDays;
      document.getElementById('unionRuleHint').textContent = sector.desc;
    } else {
      document.getElementById('unionRuleHint').textContent =
        'Modo manual ativo: configure livremente sua jornada em HH:MM, multiplicadores e prazo de validade.';
    }
  }

  function openSettingsModal() {
    lastFocusedEl = document.activeElement;
    populateSettingsSelects();
    const settings = ctx.getSettings();

    document.getElementById('settingUserName').value = settings.userName || '';
    const unionSel = document.getElementById('settingUnionCode');
    unionSel.value = findUnionByCode(settings.unionCode) ? settings.unionCode : 'sindpd_sp';

    const sectorSel = document.getElementById('settingCompanySector');
    sectorSel.value = findSectorByCode(settings.companySector) ? settings.companySector : 'tecnologia';

    setSettingsUnionModeUI(settings.unionMode || 'sector');
    document.getElementById('settingStateUf').value = settings.stateUf || 'SP';
    document.getElementById('settingDailyHHMM').value = formatHHMM(settings.dailyMinutes || 480);
    document.getElementById('settingOvertimeMult').value = settings.overtimeMultiplier ?? 1.5;
    document.getElementById('settingHolidayMult').value = settings.holidayMultiplier ?? 1.0;
    document.getElementById('settingExpiryDays').value = settings.expiryDays || 180;
    document.getElementById('settingManagerEmail').value = settings.managerEmail || '';
    document.getElementById('settingManagerPhone').value = settings.managerPhone || '';

    if (settings.unionMode === 'union') {
      document.getElementById('unionRuleHint').textContent = findUnionByCode(settings.unionCode)?.note || '';
    } else if (settings.unionMode === 'sector') {
      document.getElementById('unionRuleHint').textContent = findSectorByCode(settings.companySector)?.desc || '';
    } else {
      document.getElementById('unionRuleHint').textContent =
        'Modo manual ativo: os parâmetros abaixo refletem sua configuração personalizada.';
    }

    document.getElementById('settingsModal').classList.remove('hidden');
    window.lucide?.createIcons();
    document.getElementById('settingUserName').focus();
  }

  function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
  }

  document.getElementById('closeSettingsModalBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('cancelSettingsModalBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettingsModal();
  });

  document.getElementById('unionModeBtn').addEventListener('click', () => {
    setSettingsUnionModeUI('union');
    applyPresetFromSelection('union');
  });
  document.getElementById('sectorModeBtn').addEventListener('click', () => {
    setSettingsUnionModeUI('sector');
    applyPresetFromSelection('sector');
  });
  document.getElementById('customModeBtn').addEventListener('click', () => {
    setSettingsUnionModeUI('custom');
    applyPresetFromSelection('custom');
  });
  document.getElementById('settingUnionCode').addEventListener('change', () => applyPresetFromSelection('union'));
  document.getElementById('settingCompanySector').addEventListener('change', () => applyPresetFromSelection('sector'));

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsedMins = parseDurationToMinutes(document.getElementById('settingDailyHHMM').value, { min: 60, max: 1440 });
    if (parsedMins === null) {
      ctx.showToast('Jornada inválida. Use HH:MM (ex.: 08:00 ou 07:20)');
      return;
    }

    const btn = document.getElementById('settingsSubmitBtn');
    const nextSettings = {
      ...ctx.getSettings(),
      userName: document.getElementById('settingUserName').value.trim(),
      unionMode: getActiveUnionModeFromUI(),
      unionCode: document.getElementById('settingUnionCode').value,
      companySector: document.getElementById('settingCompanySector').value,
      stateUf: document.getElementById('settingStateUf').value || 'SP',
      dailyMinutes: parsedMins,
      overtimeMultiplier: parseFloat(document.getElementById('settingOvertimeMult').value) || 1.0,
      holidayMultiplier: parseFloat(document.getElementById('settingHolidayMult').value) || 1.0,
      expiryDays: parseInt(document.getElementById('settingExpiryDays').value, 10) || 180,
      managerEmail: document.getElementById('settingManagerEmail').value.trim(),
      managerPhone: document.getElementById('settingManagerPhone').value.replace(/\D/g, '')
    };

    await runWithButtonLoading(btn, 'Salvando...', async () => {
      const ok = await ctx.saveSettings(nextSettings);
      if (ok) {
        try {
          localStorage.setItem(STORAGE_KEYS.HOLIDAY_UF, nextSettings.stateUf);
        } catch { /* ignore */ }
        closeSettingsModal();
      }
    });
  });

  // ==================== MODAL DE FERIADOS DINÂMICOS ====================
  function getActiveHolidayUf() {
    return ctx.getSettings().stateUf || localStorage.getItem(STORAGE_KEYS.HOLIDAY_UF) || 'SP';
  }

  function updateHolidayFilterPillsUI() {
    document.querySelectorAll('.holiday-view-pill').forEach((btn) => {
      const active = btn.dataset.holidayFilter === holidayFilter;
      btn.className = active
        ? 'holiday-view-pill px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white transition'
        : 'holiday-view-pill px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition';
    });
  }

  function renderHolidaysModalList() {
    const container = document.getElementById('holidaysListContainer');
    const entries = ctx.getEntries();
    const uf = document.getElementById('holidayUfSelect').value || getActiveHolidayUf();
    document.getElementById('holidayYearDisplay').textContent = String(holidayYear);

    const visibleItems = currentHolidayList.filter((h) => {
      const already = isHolidayAlreadyInEntries(entries, h.date, h.name);
      if (holidayFilter === 'upcoming') return !h.isPast;
      if (holidayFilter === 'available') return !already;
      return true;
    });

    if (!visibleItems.length) {
      container.innerHTML = `<div class="p-8 text-center text-xs text-slate-500 dark:text-slate-400">Nenhum feriado encontrado para o filtro selecionado em ${holidayYear} (${escapeHtml(uf)}).</div>`;
      document.getElementById('holidaySelectedCount').textContent = '0 selecionados';
      return;
    }

    container.innerHTML = visibleItems.map((h) => {
      const already = isHolidayAlreadyInEntries(entries, h.date, h.name);
      const checked = !already && selectedHolidayDates.has(h.date);
      const weekend = isWeekendISO(h.date);
      const weekday = getWeekdayShortBR(h.date);

      let timingBadge = '';
      if (h.isToday) {
        timingBadge = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Hoje</span>';
      } else if (!h.isPast && h.daysDiff <= 45) {
        timingBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">Em ${h.daysDiff}d</span>`;
      } else if (h.isPast) {
        timingBadge = '<span class="text-[10px] text-slate-400">Passado</span>';
      }

      return `
        <div class="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
          <div class="flex items-center gap-3 min-w-0">
            <input
              type="checkbox"
              data-holiday-date="${h.date}"
              aria-label="Selecionar ${escapeHtml(h.name)}"
              ${already ? 'disabled' : ''}
              ${checked ? 'checked' : ''}
              class="holiday-checkbox w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 cursor-pointer shrink-0"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">${formatDateBR(h.date)} (${weekday})</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${h.scope === 'Nacional' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}">${escapeHtml(h.scope)}</span>
                ${weekend ? '<span class="text-[10px] font-medium text-amber-600 dark:text-amber-400">Fim de semana</span>' : ''}
                ${timingBadge}
              </div>
              <p class="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate mt-0.5">${escapeHtml(h.name)}</p>
            </div>
          </div>

          <div class="shrink-0 flex items-center gap-2">
            ${already
              ? '<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">Já no extrato</span>'
              : `<button type="button" data-quick-holiday-date="${h.date}" class="quick-add-holiday-btn px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-xs font-semibold transition">+ Lançar</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('holidaySelectedCount').textContent =
      `${selectedHolidayDates.size} ${selectedHolidayDates.size === 1 ? 'selecionado' : 'selecionados'}`;
  }

  async function refreshHolidaysView(forceRefresh = false) {
    const ufSelect = document.getElementById('holidayUfSelect');
    const uf = ufSelect.value || getActiveHolidayUf();
    document.getElementById('holidaysMetaText').textContent = `Carregando calendário de ${holidayYear}...`;
    const result = await fetchHolidaysForYear(holidayYear, uf, forceRefresh);
    currentHolidayList = result.items;
    document.getElementById('holidaysMetaText').textContent =
      `Ano ${result.year} (${result.stateUf}) • Fonte: ${result.sourceLabel} • Atualizado em ${result.updatedAt}`;
    renderHolidaysModalList();
  }

  async function openHolidaysModal() {
    lastFocusedEl = document.activeElement;
    populateSettingsSelects();
    holidayYear = new Date().getFullYear();
    holidayFilter = 'all';
    selectedHolidayDates.clear();
    updateHolidayFilterPillsUI();

    const uf = getActiveHolidayUf();
    document.getElementById('holidayUfSelect').value = uf;
    document.getElementById('holidaysModal').classList.remove('hidden');
    window.lucide?.createIcons();
    await refreshHolidaysView(false);
  }

  function closeHolidaysModal() {
    document.getElementById('holidaysModal').classList.add('hidden');
  }

  document.getElementById('closeHolidaysModalBtn').addEventListener('click', closeHolidaysModal);
  document.getElementById('cancelHolidaysBtn').addEventListener('click', closeHolidaysModal);
  document.getElementById('holidaysModal').addEventListener('click', (e) => {
    if (e.target.id === 'holidaysModal') closeHolidaysModal();
  });

  document.getElementById('prevHolidayYearBtn').addEventListener('click', async () => {
    holidayYear -= 1;
    selectedHolidayDates.clear();
    await refreshHolidaysView(false);
  });

  document.getElementById('nextHolidayYearBtn').addEventListener('click', async () => {
    holidayYear += 1;
    selectedHolidayDates.clear();
    await refreshHolidaysView(false);
  });

  document.getElementById('currentYearHolidayBtn').addEventListener('click', async () => {
    holidayYear = new Date().getFullYear();
    selectedHolidayDates.clear();
    await refreshHolidaysView(false);
  });

  document.getElementById('holidayUfSelect').addEventListener('change', async (e) => {
    const newUf = e.target.value;
    try {
      localStorage.setItem(STORAGE_KEYS.HOLIDAY_UF, newUf);
    } catch { /* ignore */ }
    selectedHolidayDates.clear();
    await refreshHolidaysView(false);
    // Se for UF brasileira válida, atualiza settings na nuvem silenciosamente sem apagar dados
    if (newUf !== 'NONE' && ctx.getSettings().stateUf !== newUf) {
      await ctx.saveSettings({ ...ctx.getSettings(), stateUf: newUf }, { silentToast: true });
    }
  });

  document.getElementById('refreshHolidaysBtn').addEventListener('click', async () => {
    await refreshHolidaysView(true);
    ctx.showToast(`Calendário ${holidayYear} sincronizado!`);
  });

  document.querySelectorAll('.holiday-view-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      holidayFilter = btn.dataset.holidayFilter;
      updateHolidayFilterPillsUI();
      renderHolidaysModalList();
    });
  });

  document.getElementById('selectAllHolidaysBtn').addEventListener('click', () => {
    const entries = ctx.getEntries();
    selectedHolidayDates.clear();
    currentHolidayList.forEach((h) => {
      if (!isHolidayAlreadyInEntries(entries, h.date, h.name)) {
        if (holidayFilter === 'upcoming' && h.isPast) return;
        selectedHolidayDates.add(h.date);
      }
    });
    renderHolidaysModalList();
  });

  document.getElementById('clearSelectionHolidaysBtn').addEventListener('click', () => {
    selectedHolidayDates.clear();
    renderHolidaysModalList();
  });

  document.getElementById('holidaysListContainer').addEventListener('change', (e) => {
    const cb = e.target.closest('.holiday-checkbox');
    if (!cb) return;
    if (cb.checked) selectedHolidayDates.add(cb.dataset.holidayDate);
    else selectedHolidayDates.delete(cb.dataset.holidayDate);
    document.getElementById('holidaySelectedCount').textContent =
      `${selectedHolidayDates.size} ${selectedHolidayDates.size === 1 ? 'selecionado' : 'selecionados'}`;
  });

  document.getElementById('holidaysListContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-add-holiday-btn');
    if (!btn) return;
    const h = currentHolidayList.find((item) => item.date === btn.dataset.quickHolidayDate);
    if (!h) return;
    const settings = ctx.getSettings();
    closeHolidaysModal();
    openEntryModal({
      type: 'credit',
      category: 'holiday',
      date: h.date,
      title: `${h.name} (Plantão/Feriado)`,
      minutes: settings.dailyMinutes,
      status: h.date <= getLocalDateISO() ? 'realized' : 'planned',
      expiry: addDaysToISO(h.date, settings.expiryDays),
      notes: `Feriado ${h.scope}`
    }, false);
  });

  document.getElementById('importSelectedHolidaysBtn').addEventListener('click', async () => {
    const entries = ctx.getEntries();
    const settings = ctx.getSettings();
    const chosen = currentHolidayList.filter(
      (h) => selectedHolidayDates.has(h.date) && !isHolidayAlreadyInEntries(entries, h.date, h.name)
    );
    if (!chosen.length) {
      ctx.showToast('Selecione ao menos um feriado disponível');
      return;
    }

    const btn = document.getElementById('importSelectedHolidaysBtn');
    const mult = Number(settings.holidayMultiplier) || 1.0;
    const workedMins = Number(settings.dailyMinutes) || 480;
    const creditedMins = applyMultiplierToMinutes(workedMins, mult);
    const todayISO = getLocalDateISO();

    const newEntries = chosen.map((h) => ({
      id: generateUUID(),
      type: 'credit',
      category: 'holiday',
      date: h.date,
      title: `${h.name} (Feriado)`,
      minutes: creditedMins,
      workedMinutes: workedMins,
      multiplier: mult,
      status: h.date <= todayISO ? 'realized' : 'planned',
      expiry: addDaysToISO(h.date, settings.expiryDays),
      notes: `Feriado ${h.scope}`,
      createdAt: new Date().toISOString()
    }));

    await runWithButtonLoading(btn, 'Adicionando...', async () => {
      const ok = await ctx.addEntriesBatch(newEntries);
      if (ok) {
        selectedHolidayDates.clear();
        renderHolidaysModalList();
        ctx.showToast(`${newEntries.length} ${newEntries.length === 1 ? 'feriado adicionado' : 'feriados adicionados'}!`);
      }
    });
  });

  return {
    confirmDialog,
    resolveConfirm,
    openEntryModal,
    closeEntryModal,
    openSettingsModal,
    closeSettingsModal,
    openHolidaysModal,
    closeHolidaysModal,
    handleEscapeKey() {
      if (!document.getElementById('confirmModal').classList.contains('hidden')) {
        resolveConfirm(false);
        return true;
      }
      if (!document.getElementById('entryModal').classList.contains('hidden')) {
        closeEntryModal();
        return true;
      }
      if (!document.getElementById('holidaysModal').classList.contains('hidden')) {
        closeHolidaysModal();
        return true;
      }
      if (!document.getElementById('settingsModal').classList.contains('hidden')) {
        closeSettingsModal();
        return true;
      }
      return false;
    }
  };
}
