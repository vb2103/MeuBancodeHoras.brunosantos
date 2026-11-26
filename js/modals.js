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
import { fetchHolidaysForYear, getHolidayBridgeOpportunity, isHolidayAlreadyInEntries } from './holidays.js';
import { SECTOR_CATALOG, UNION_CATALOG, findSectorByCode, findUnionByCode } from './rules-catalog.js';
import { applyMultiplierToMinutes, computePunchBalance, formatHHMM, isInitialBalanceEntry, parseDurationToMinutes } from './time.js';

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
  let confirmLastFocusedEl = null;

  let holidayYear = new Date().getFullYear();
  let holidayFilter = 'all'; // 'all' | 'upcoming' | 'available'
  let currentHolidayList = [];
  const selectedHolidayDates = new Set();
  const externalModals = [];

  function captureLastFocus() {
    lastFocusedEl = document.activeElement;
  }

  function focusDesktopOnly(el) {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      el?.focus();
    }
  }

  function restoreLastFocus() {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (lastFocusedEl && lastFocusedEl !== document.body && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
  }

  function getOpenModalElement() {
    const ids = ['confirmModal', 'writeOffModal', 'initialSetupModal', 'shortcutsModal', 'entryIntentModal', 'entryModal', 'holidaysModal', 'settingsModal', ...externalModals.map((m) => m.id)];
    return ids.map((id) => document.getElementById(id)).find((el) => el && !el.classList.contains('hidden')) || null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = getOpenModalElement();
    if (!modal) return;

    const focusables = Array.from(
      modal.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ==================== MODAL PRÓPRIO DE CONFIRMAÇÃO ====================
  function confirmDialog({
    title = 'Confirmar ação',
    message = 'Deseja continuar?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger'
  } = {}) {
    return new Promise((resolve) => {
      confirmLastFocusedEl = document.activeElement;
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
    if (confirmLastFocusedEl && confirmLastFocusedEl !== document.body && typeof confirmLastFocusedEl.focus === 'function') {
      confirmLastFocusedEl.focus();
    }
    confirmLastFocusedEl = null;
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

  // ==================== MODAL DE ATALHOS DE TECLADO ====================
  function openShortcutsModal() {
    lastFocusedEl = document.activeElement;
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    window.lucide?.createIcons();
    document.getElementById('confirmShortcutsModalBtn')?.focus();
  }

  function closeShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    restoreLastFocus();
  }

  document.getElementById('openShortcutsBtn')?.addEventListener('click', openShortcutsModal);
  document.getElementById('closeShortcutsModalBtn')?.addEventListener('click', closeShortcutsModal);
  document.getElementById('confirmShortcutsModalBtn')?.addEventListener('click', closeShortcutsModal);
  document.getElementById('shortcutsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'shortcutsModal') closeShortcutsModal();
  });

  // ==================== MENU RÁPIDO DE INTENÇÃO + MODAL DE LANÇAMENTO (HH:MM) ====================
  let entryModalContext = { source: 'intent', isEditing: false };

  function getActiveEntryType() {
    return document.getElementById('entryTypeValue')?.value === 'debit' ? 'debit' : 'credit';
  }

  function setActiveEntryType(typeVal) {
    const type = typeVal === 'debit' ? 'debit' : 'credit';
    const hiddenEl = document.getElementById('entryTypeValue');
    if (hiddenEl) hiddenEl.value = type;
    const editTypeSel = document.getElementById('entryEditTypeSelect');
    if (editTypeSel) editTypeSel.value = type;
    return type;
  }

  function resolveEntryModalTitle(type, isEditing, source) {
    if (isEditing) return 'Editar Lançamento';
    if (source === 'holiday') return 'Lançar Feriado Trabalhado';
    if (source === 'simulator' || source === 'bridge') return 'Agendar Folga';
    return type === 'debit' ? 'Registrar Folga' : 'Registrar Horas Ganhas';
  }

  function openEntryIntentModal() {
    lastFocusedEl = document.activeElement;
    const modal = document.getElementById('entryIntentModal');
    if (!modal) {
      openEntryModal(null, false, { source: 'intent' });
      return;
    }
    modal.classList.remove('hidden');
    window.lucide?.createIcons();
    focusDesktopOnly(document.getElementById('intentCreditBtn'));
  }

  function closeEntryIntentModal({ restoreFocus = true } = {}) {
    const modal = document.getElementById('entryIntentModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (restoreFocus) restoreLastFocus();
  }

  document.getElementById('closeEntryIntentBtn')?.addEventListener('click', () => closeEntryIntentModal({ restoreFocus: true }));
  document.getElementById('entryIntentModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'entryIntentModal') closeEntryIntentModal({ restoreFocus: true });
  });
  document.getElementById('intentCreditBtn')?.addEventListener('click', () => {
    closeEntryIntentModal({ restoreFocus: false });
    openEntryModal({ type: 'credit' }, false, { source: 'intent' });
  });
  document.getElementById('intentDebitBtn')?.addEventListener('click', () => {
    closeEntryIntentModal({ restoreFocus: false });
    openEntryModal({ type: 'debit', category: 'time_off' }, false, { source: 'intent' });
  });

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

  function syncFocusedFormModeUI(type, { isEditing = false, source = 'intent', date = '' } = {}) {
    const isCredit = type === 'credit';
    const isHolidayLocked = !isEditing && source === 'holiday';

    document.getElementById('entryModalTitle').textContent = resolveEntryModalTitle(type, isEditing, source);

    const backBtn = document.getElementById('backToEntryIntentBtn');
    const showBack = !isEditing && source === 'intent';
    if (backBtn) {
      backBtn.classList.toggle('hidden', !showBack);
      backBtn.classList.toggle('inline-flex', showBack);
    }

    const ctxBadge = document.getElementById('entryContextBadge');
    const ctxText = document.getElementById('entryContextBadgeText');
    if (ctxBadge && ctxText) {
      ctxBadge.classList.toggle('hidden', !isHolidayLocked);
      ctxBadge.classList.toggle('flex', isHolidayLocked);
      if (isHolidayLocked) {
        const dStr = date || document.getElementById('entryDate')?.value || getLocalDateISO();
        ctxText.textContent = `${formatDateBR(dStr)} • ${ENTRY_CATEGORIES.holiday.label}`;
      }
    }

    const dateCatGrid = document.getElementById('entryDateCatGrid');
    const dateShortcutsRow = document.getElementById('entryDateShortcutsRow');
    const dateWrapper = document.getElementById('entryDateWrapper');
    const catWrapper = document.getElementById('entryCategoryWrapper');
    if (dateCatGrid) dateCatGrid.classList.toggle('hidden', isHolidayLocked);
    if (dateShortcutsRow) dateShortcutsRow.classList.toggle('hidden', isHolidayLocked);

    // No modo Folga novo/agendado, mantém apenas categoria padrão time_off ocultando o select; em Edição/Crédito exibe
    const showCategoryField = !isHolidayLocked && (isCredit || isEditing);
    if (catWrapper) catWrapper.classList.toggle('hidden', !showCategoryField);
    if (dateWrapper) dateWrapper.classList.toggle('sm:col-span-2', !showCategoryField);

    document.getElementById('expiryFieldWrapper').classList.toggle('hidden', !isCredit);
    document.getElementById('entryEditTypeWrapper')?.classList.toggle('hidden', !isEditing);

    const advToggleLabel = document.getElementById('entryAdvancedToggleLabel');
    if (advToggleLabel) {
      advToggleLabel.textContent = isCredit
        ? 'Mais opções (bônus, status, prazo e notas)'
        : (isEditing ? 'Mais opções (tipo, status e notas)' : 'Mais opções (status e observações)');
    }
  }

  function getActiveMultiplierForForm() {
    const type = getActiveEntryType();
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

  const CHIP_ACTIVE_CLS = 'duration-chip min-h-[44px] px-1 rounded-xl border border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200 ring-1 ring-indigo-500/40 text-xs font-semibold whitespace-nowrap flex items-center justify-center transition';
  const CHIP_INACTIVE_CLS = 'duration-chip min-h-[44px] px-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap flex items-center justify-center transition';
  const DATE_SHORTCUT_ACTIVE_CLS = 'px-2.5 py-1 rounded-lg border border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200 text-[11px] font-semibold transition';
  const DATE_SHORTCUT_INACTIVE_CLS = 'px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition';

  function setDurationParts(totalMinutes) {
    const safeMins = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hh = Math.min(300, Math.floor(safeMins / 60));
    const mm = safeMins % 60;
    document.getElementById('entryHoursPart').value = String(hh).padStart(2, '0');
    document.getElementById('entryMinutesPart').value = String(mm).padStart(2, '0');
  }

  function syncEntryTitlePlaceholder(typeVal = null) {
    const titleInput = document.getElementById('entryTitle');
    if (!titleInput) return;
    const type = typeVal || getActiveEntryType();
    titleInput.placeholder = type === 'debit'
      ? 'Ex.: Consulta médica ou emenda de feriado'
      : 'Ex.: Plantão de feriado ou hora extra';
  }

  function syncEntryDateShortcutsUI() {
    const val = document.getElementById('entryDate')?.value || '';
    const today = getLocalDateISO();
    const yesterday = addDaysToISO(today, -1);
    const todayBtn = document.getElementById('entryDateTodayBtn');
    const yesterdayBtn = document.getElementById('entryDateYesterdayBtn');
    if (todayBtn) {
      const isToday = val === today;
      todayBtn.className = isToday ? DATE_SHORTCUT_ACTIVE_CLS : DATE_SHORTCUT_INACTIVE_CLS;
      todayBtn.setAttribute('aria-pressed', String(isToday));
    }
    if (yesterdayBtn) {
      const isYesterday = val === yesterday;
      yesterdayBtn.className = isYesterday ? DATE_SHORTCUT_ACTIVE_CLS : DATE_SHORTCUT_INACTIVE_CLS;
      yesterdayBtn.setAttribute('aria-pressed', String(isYesterday));
    }
  }

  function syncDurationQuickChipsSelection(baseMins) {
    const dailyMins = Number(ctx.getSettings().dailyMinutes) || 480;
    const halfMins = Math.round(dailyMins / 2);
    const fullBtn = document.getElementById('fillJourneyBtn');
    const halfBtn = document.getElementById('fillHalfJourneyBtn');
    const matchedFull = baseMins === dailyMins;
    const matchedHalf = !matchedFull && baseMins === halfMins;

    document.querySelectorAll('#durationQuickChips [data-quick-mins]').forEach((btn) => {
      const target = Number(btn.dataset.quickMins);
      const isMatch = !matchedFull && !matchedHalf && baseMins === target;
      btn.className = isMatch ? CHIP_ACTIVE_CLS : CHIP_INACTIVE_CLS;
      btn.setAttribute('aria-pressed', String(isMatch));
    });

    if (halfBtn) {
      halfBtn.className = matchedHalf
        ? CHIP_ACTIVE_CLS.replace('text-xs', 'text-[11px] sm:text-xs')
        : CHIP_INACTIVE_CLS.replace('text-xs', 'text-[11px] sm:text-xs');
      halfBtn.setAttribute('aria-pressed', String(matchedHalf));
    }
    if (fullBtn) {
      fullBtn.className = matchedFull ? CHIP_ACTIVE_CLS : CHIP_INACTIVE_CLS;
      fullBtn.setAttribute('aria-pressed', String(matchedFull));
    }
  }

  function updateEntryComputedPreview() {
    const type = getActiveEntryType();
    const multWrapper = document.getElementById('multiplierWrapper');
    const customBox = document.getElementById('customMultiplierBox');
    const preset = document.getElementById('entryRulePreset').value;
    const isEditing = Boolean(document.getElementById('entryId')?.value);

    multWrapper.classList.toggle('hidden', type !== 'credit');
    customBox.classList.toggle('hidden', type !== 'credit' || preset !== 'custom');
    customBox.classList.toggle('flex', type === 'credit' && preset === 'custom');

    const hh = Math.min(300, Math.max(0, parseInt(document.getElementById('entryHoursPart').value, 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(document.getElementById('entryMinutesPart').value, 10) || 0));
    const baseMins = hh * 60 + mm;
    syncDurationQuickChipsSelection(baseMins);
    syncEntryDateShortcutsUI();

    const liveSummary = document.getElementById('entryLiveRuleSummary');
    const liveSub = document.getElementById('entryLiveRuleSub');
    const submitBtn = document.getElementById('entrySubmitBtn');
    const statusVal = document.getElementById('entryStatus')?.value || 'realized';

    if (type === 'credit') {
      const mult = getActiveMultiplierForForm();
      const creditedMins = applyMultiplierToMinutes(baseMins, mult);
      const formattedCredited = formatHHMM(creditedMins, true);
      document.getElementById('entryComputedPreview').textContent =
        `Trabalhado ${formatHHMM(baseMins)} × ${mult}x = ${formattedCredited}`;

      if (liveSummary) {
        liveSummary.innerHTML = `Vai entrar <strong class="font-mono font-bold text-emerald-600 dark:text-emerald-400">${escapeHtml(formattedCredited)}</strong> no banco`;
      }
      if (liveSub) {
        const expVal = document.getElementById('entryExpiry')?.value;
        const subParts = [];
        if (mult !== 1) subParts.push(`Regra ${mult}x`);
        if (expVal) subParts.push(`Vence em ${formatDateBR(expVal)}`);
        if (statusVal === 'planned') subParts.push('Previsto');
        liveSub.textContent = subParts.join(' • ');
        liveSub.classList.toggle('hidden', subParts.length === 0);
      }
      if (submitBtn && submitBtn.dataset.busy !== '1') {
        submitBtn.textContent = isEditing ? `Atualizar ${formattedCredited}` : `Salvar ${formattedCredited}`;
      }
    } else {
      const formattedDebit = formatHHMM(-baseMins, true);
      if (liveSummary) {
        liveSummary.innerHTML = `Vai descontar <strong class="font-mono font-bold text-rose-600 dark:text-rose-400">${escapeHtml(formattedDebit)}</strong> do banco`;
      }
      if (liveSub) {
        const subText = statusVal === 'planned' ? 'Agendado como folga prevista' : '';
        liveSub.textContent = subText;
        liveSub.classList.toggle('hidden', !subText);
      }
      if (submitBtn && submitBtn.dataset.busy !== '1') {
        submitBtn.textContent = isEditing
          ? `Atualizar Folga (${formattedDebit})`
          : `Registrar Folga (${formattedDebit})`;
      }
    }
  }

  function setEntryAdvancedOpen(isOpen) {
    const advBox = document.getElementById('entryAdvancedBox');
    const toggleBtn = document.getElementById('toggleEntryAdvancedBtn');
    const chevron = document.getElementById('entryAdvancedChevron');
    advBox?.classList.toggle('is-open', Boolean(isOpen));
    toggleBtn?.setAttribute('aria-expanded', String(Boolean(isOpen)));
    chevron?.classList.toggle('rotate-180', Boolean(isOpen));
  }

  function openEntryModal(data = null, isEditing = false, context = {}) {
    lastFocusedEl = document.activeElement;
    const settings = ctx.getSettings();
    const source = isEditing ? 'edit' : (context?.source || (data?.category === 'holiday' ? 'holiday' : 'intent'));
    const typeVal = setActiveEntryType(data?.type || 'credit');
    entryModalContext = { source, isEditing };

    document.getElementById('entryForm').reset();
    document.getElementById('entryId').value = isEditing && data?.id ? data.id : '';
    setActiveEntryType(typeVal);

    const today = getLocalDateISO();
    const targetDate = data?.date || today;
    document.getElementById('entryDate').value = targetDate;
    document.getElementById('entryTitle').value = data?.title || '';
    document.getElementById('entryStatus').value = data?.status || 'realized';
    document.getElementById('entryNotes').value = data?.notes || '';

    syncEntryTitlePlaceholder(typeVal);
    syncCategoryOptionsForType(typeVal, data?.category || null);
    syncFocusedFormModeUI(typeVal, { isEditing, source, date: targetDate });

    const totalMins = isEditing
      ? (Number(data?.workedMinutes) || Number(data?.minutes) || settings.dailyMinutes)
      : (Number(data?.minutes) || Number(settings.dailyMinutes) || 480);

    setDurationParts(totalMins);

    const presetSel = document.getElementById('entryRulePreset');
    if (isEditing && data?.multiplier) {
      const mult = Number(data.multiplier);
      if (data.category === 'holiday' && mult === Number(settings.holidayMultiplier)) {
        presetSel.value = 'union_holiday';
      } else if (data.category === 'overtime' && mult === Number(settings.overtimeMultiplier)) {
        presetSel.value = 'union_overtime';
      } else if ([1, 1.4, 1.5, 2].includes(mult)) {
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
    const shouldOpenAdv = Boolean(
      isEditing && (
        data?.notes
        || data?.status === 'planned'
        || presetSel.value === 'custom'
      )
    );
    setEntryAdvancedOpen(shouldOpenAdv);
    document.getElementById('punchCalcPanel')?.classList.add('hidden');
    document.getElementById('entryModal').classList.remove('hidden');
    window.lucide?.createIcons();
    focusDesktopOnly(document.getElementById('entryTitle'));
  }

  function closeEntryModal({ restoreFocus = true } = {}) {
    document.getElementById('entryModal').classList.add('hidden');
    if (restoreFocus) restoreLastFocus();
  }

  document.getElementById('closeEntryModalBtn').addEventListener('click', () => closeEntryModal({ restoreFocus: true }));
  document.getElementById('backToEntryIntentBtn')?.addEventListener('click', () => {
    closeEntryModal({ restoreFocus: false });
    openEntryIntentModal();
  });
  document.getElementById('entryModal').addEventListener('click', (e) => {
    if (e.target.id === 'entryModal') closeEntryModal({ restoreFocus: true });
  });

  function applyEntryTypeSwitch(nextType) {
    const type = setActiveEntryType(nextType);
    const settings = ctx.getSettings();
    syncEntryTitlePlaceholder(type);
    syncCategoryOptionsForType(type);
    syncFocusedFormModeUI(type, entryModalContext);
    if (type === 'credit') {
      if (!document.getElementById('entryExpiry').value) {
        const baseDate = document.getElementById('entryDate').value || getLocalDateISO();
        document.getElementById('entryExpiry').value = addDaysToISO(baseDate, settings.expiryDays);
      }
      document.getElementById('entryRulePreset').value =
        document.getElementById('entryCategory').value === 'holiday' ? 'union_holiday' : 'union_overtime';
    }
    updateEntryComputedPreview();
  }

  document.getElementById('entryEditTypeSelect')?.addEventListener('change', (e) => {
    applyEntryTypeSwitch(e.target.value);
  });

  document.getElementById('entryCategory').addEventListener('change', (e) => {
    const cat = e.target.value;
    const type = getActiveEntryType();
    if (type !== 'credit') return;
    const presetSel = document.getElementById('entryRulePreset');
    if (cat === 'holiday') presetSel.value = 'union_holiday';
    else if (cat === 'overtime') presetSel.value = 'union_overtime';
    else presetSel.value = '1.0';
    updateEntryComputedPreview();
  });

  function applyEntryDateShortcut(targetISO) {
    const dateInput = document.getElementById('entryDate');
    if (!dateInput) return;
    dateInput.value = targetISO;
    const type = getActiveEntryType();
    const isNew = !document.getElementById('entryId').value;
    const settings = ctx.getSettings();
    if (type === 'credit' && isNew && targetISO) {
      document.getElementById('entryExpiry').value = addDaysToISO(targetISO, settings.expiryDays);
    }
    updateEntryComputedPreview();
  }

  document.getElementById('entryDateTodayBtn')?.addEventListener('click', () => {
    applyEntryDateShortcut(getLocalDateISO());
  });

  document.getElementById('entryDateYesterdayBtn')?.addEventListener('click', () => {
    applyEntryDateShortcut(addDaysToISO(getLocalDateISO(), -1));
  });

  document.getElementById('entryDate').addEventListener('change', () => {
    applyEntryDateShortcut(document.getElementById('entryDate').value);
  });

  document.getElementById('fillJourneyBtn').addEventListener('click', () => {
    const dMins = Number(ctx.getSettings().dailyMinutes) || 480;
    setDurationParts(dMins);
    updateEntryComputedPreview();
  });

  document.getElementById('fillHalfJourneyBtn')?.addEventListener('click', () => {
    const halfMins = Math.round((Number(ctx.getSettings().dailyMinutes) || 480) / 2);
    setDurationParts(halfMins);
    updateEntryComputedPreview();
  });

  document.querySelectorAll('[data-quick-mins]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.dataset.quickMins) || 60;
      setDurationParts(mins);
      updateEntryComputedPreview();
    });
  });

  ['entryHoursPart', 'entryMinutesPart'].forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D/g, '');
      if (input.value !== clean) input.value = clean;
      updateEntryComputedPreview();
    });
    input.addEventListener('blur', () => {
      const val = parseInt(input.value, 10) || 0;
      const clamped = id === 'entryHoursPart' ? Math.min(300, Math.max(0, val)) : Math.min(59, Math.max(0, val));
      input.value = String(clamped).padStart(2, '0');
      updateEntryComputedPreview();
    });
  });
  document.getElementById('entryRulePreset').addEventListener('change', updateEntryComputedPreview);
  document.getElementById('entryCustomMultiplier').addEventListener('input', updateEntryComputedPreview);
  document.getElementById('entryStatus')?.addEventListener('change', updateEntryComputedPreview);
  document.getElementById('entryExpiry')?.addEventListener('change', updateEntryComputedPreview);
  document.getElementById('toggleEntryAdvancedBtn')?.addEventListener('click', () => {
    const isOpen = document.getElementById('entryAdvancedBox')?.classList.contains('is-open');
    setEntryAdvancedOpen(!isOpen);
  });

  let selectedPunchBreakMode = '60'; // '0' | '60' | 'custom'

  function getSelectedPunchBreakMinutes() {
    if (selectedPunchBreakMode === '0') return 0;
    if (selectedPunchBreakMode === '60') return 60;
    const raw = document.getElementById('punchCustomBreakInput')?.value?.trim() || '';
    if (!raw) return 0;
    const parsed = parseDurationToMinutes(raw, { min: 0, max: 720 });
    return parsed !== null ? parsed : 0;
  }

  function syncPunchBreakChipsUI() {
    const customBox = document.getElementById('punchCustomBreakBox');
    customBox?.classList.toggle('hidden', selectedPunchBreakMode !== 'custom');

    document.querySelectorAll('[data-punch-break]').forEach((btn) => {
      const isSelected = btn.dataset.punchBreak === selectedPunchBreakMode;
      btn.className = isSelected
        ? 'min-h-[38px] px-3 py-1.5 rounded-xl border border-indigo-500 bg-indigo-600 text-white text-xs font-semibold transition'
        : 'min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium transition';
    });
  }

  function getPunchCalcResult() {
    const dailyMinutes = Number(ctx.getSettings().dailyMinutes) || 480;
    const compareWithJourney = Boolean(document.getElementById('punchCompareJourney')?.checked);
    return computePunchBalance({
      entryTime: document.getElementById('punchIn')?.value || '',
      exitTime: document.getElementById('punchOut')?.value || '',
      breakMinutes: getSelectedPunchBreakMinutes(),
      dailyMinutes,
      compareWithJourney
    });
  }

  function updatePunchCalcPreview() {
    const hint = document.getElementById('punchJourneyHint');
    if (hint) hint.textContent = formatHHMM(Number(ctx.getSettings().dailyMinutes) || 480);

    const preview = document.getElementById('punchCalcPreview');
    const nextDayBadge = document.getElementById('punchNextDayBadge');
    const entryVal = document.getElementById('punchIn')?.value || '--:--';
    const exitVal = document.getElementById('punchOut')?.value || '--:--';
    const res = getPunchCalcResult();

    nextDayBadge?.classList.toggle('hidden', !res?.crossesMidnight);

    if (!preview) return;
    if (!res) {
      preview.textContent = 'Preencha horários válidos de entrada e saída.';
      return;
    }

    const dayNote = res.crossesMidnight ? ' (dia seguinte)' : '';
    const breakNote = res.breakMinutes > 0
      ? ` − ${formatHHMM(res.breakMinutes)} intervalo`
      : ' (sem intervalo)';
    const baseFormula = `${entryVal} às ${exitVal}${dayNote}${breakNote} = ${formatHHMM(res.workedMinutes)}`;

    if (document.getElementById('punchCompareJourney')?.checked) {
      if (res.diffMinutes === 0) {
        preview.textContent = `${baseFormula} • Igual à jornada (00:00)`;
      } else {
        const tag = res.suggestedType === 'credit' ? 'Crédito' : 'Folga/Débito';
        preview.textContent = `${baseFormula} vs jornada → ${formatHHMM(res.diffMinutes, true)} (${tag})`;
      }
    } else {
      preview.textContent = baseFormula;
    }
  }

  document.getElementById('togglePunchCalcBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('punchCalcPanel');
    if (!panel) return;
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    if (willOpen) {
      selectedPunchBreakMode = '60';
      syncPunchBreakChipsUI();
      const cmpBox = document.getElementById('punchCompareJourney');
      if (cmpBox) cmpBox.checked = false;
      updatePunchCalcPreview();
    }
  });

  document.querySelectorAll('[data-punch-break]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPunchBreakMode = btn.dataset.punchBreak || '60';
      syncPunchBreakChipsUI();
      updatePunchCalcPreview();
      if (selectedPunchBreakMode === 'custom') {
        document.getElementById('punchCustomBreakInput')?.focus();
      }
    });
  });

  ['punchIn', 'punchOut', 'punchCustomBreakInput', 'punchCompareJourney'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updatePunchCalcPreview);
    document.getElementById(id)?.addEventListener('change', updatePunchCalcPreview);
  });

  document.getElementById('applyPunchCalcBtn')?.addEventListener('click', () => {
    const res = getPunchCalcResult();
    if (!res) {
      ctx.showToast('Informe horários válidos no bate-ponto.');
      return;
    }
    const compareWithJourney = Boolean(document.getElementById('punchCompareJourney')?.checked);
    const appliedMins = compareWithJourney ? res.durationMinutes : res.workedMinutes;
    if (appliedMins <= 0) {
      ctx.showToast('Diferença igual a 00:00 em relação à jornada.');
      return;
    }

    if (compareWithJourney) {
      applyEntryTypeSwitch(res.suggestedType);
    }

    setDurationParts(appliedMins);
    updateEntryComputedPreview();
    ctx.showToast(`Ponto calculado: ${formatHHMM(appliedMins)} aplicados!`);
  });

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
    const type = getActiveEntryType();
    const category = document.getElementById('entryCategory').value || (type === 'debit' ? 'time_off' : 'manual');
    const multiplier = type === 'credit' ? getActiveMultiplierForForm() : 1.0;
    const finalMinutes = type === 'credit' ? applyMultiplierToMinutes(workedMinutes, multiplier) : workedMinutes;

    const entryDate = document.getElementById('entryDate').value;
    const rawTitle = document.getElementById('entryTitle').value.trim();
    const entryTitle = rawTitle || ENTRY_CATEGORIES[category]?.label || (type === 'debit' ? 'Folga Compensatória' : 'Hora Extra');

    // Detecção de duplicidade: outro registro com a mesma data e mesmo título
    const existingSame = ctx.getEntries().find(
      (x) => x.id !== id && x.date === entryDate && x.title.trim().toLowerCase() === entryTitle.toLowerCase()
    );
    if (existingSame) {
      const proceed = await confirmDialog({
        title: 'Possível Lançamento Duplicado',
        message: `Já existe um lançamento registrado em ${formatDateBR(entryDate)} com o título "${entryTitle}" (${formatHHMM(existingSame.minutes)}). Deseja salvar mesmo assim?`,
        confirmText: 'Salvar mesmo assim',
        cancelText: 'Voltar e revisar',
        variant: 'warning'
      });
      if (!proceed) return;
    }

    const entryObj = {
      id,
      type,
      date: entryDate,
      minutes: finalMinutes,
      workedMinutes,
      multiplier,
      category,
      title: entryTitle,
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

  function setSettingsAdvancedOpen(isOpen) {
    const box = document.getElementById('settingsAdvancedBox');
    const btn = document.getElementById('toggleSettingsAdvancedBtn');
    const chevron = document.getElementById('settingsAdvancedChevron');
    box?.classList.toggle('hidden', !isOpen);
    btn?.setAttribute('aria-expanded', String(Boolean(isOpen)));
    chevron?.classList.toggle('rotate-180', Boolean(isOpen));
  }

  function updateSettingsRuleSummaryCard() {
    const parsedDaily = parseDurationToMinutes(document.getElementById('settingDailyHHMM')?.value || '', { min: 60, max: 1440 });
    const dailyMins = parsedDaily || Number(ctx.getSettings().dailyMinutes) || 480;
    const otMult = parseFloat(document.getElementById('settingOvertimeMult')?.value) || 1.0;
    const holMult = parseFloat(document.getElementById('settingHolidayMult')?.value) || 1.0;
    const expDays = parseInt(document.getElementById('settingExpiryDays')?.value, 10) || 180;

    const otOneHour = applyMultiplierToMinutes(60, otMult);
    const holOneDay = applyMultiplierToMinutes(dailyMins, holMult);

    const elJourney = document.getElementById('ruleSummaryJourney');
    const elExpiry = document.getElementById('ruleSummaryExpiry');
    const elOvertime = document.getElementById('ruleSummaryOvertime');
    const elHoliday = document.getElementById('ruleSummaryHoliday');
    const otHint = document.getElementById('overtimeMultHint');
    const holHint = document.getElementById('holidayMultHint');

    if (elJourney) elJourney.textContent = `${formatHHMM(dailyMins)}/dia`;
    if (elExpiry) elExpiry.textContent = `${expDays} dias`;
    if (elOvertime) elOvertime.textContent = `1h → ${formatHHMM(otOneHour, true)}`;
    if (elHoliday) elHoliday.textContent = `${formatHHMM(dailyMins)} → ${formatHHMM(holOneDay, true)}`;
    if (otHint) otHint.textContent = `1h extra = ${formatHHMM(otOneHour, true)} no banco (${otMult}x)`;
    if (holHint) holHint.textContent = `${formatHHMM(dailyMins)} trabalhadas = ${formatHHMM(holOneDay, true)} (${holMult}x)`;
  }

  function setSettingsUnionModeUI(mode) {
    const unionBtn = document.getElementById('unionModeBtn');
    const sectorBtn = document.getElementById('sectorModeBtn');
    const customBtn = document.getElementById('customModeBtn');
    const unionBox = document.getElementById('unionSelectBox');
    const sectorBox = document.getElementById('sectorSelectBox');

    const activeCls = 'px-2.5 py-2 rounded-lg bg-indigo-600 text-white transition text-center';
    const inactiveCls = 'px-2.5 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-center';

    unionBtn.className = mode === 'union' ? activeCls : inactiveCls;
    sectorBtn.className = mode === 'sector' ? activeCls : inactiveCls;
    customBtn.className = mode === 'custom' ? activeCls : inactiveCls;

    unionBox.classList.toggle('hidden', mode !== 'union');
    sectorBox.classList.toggle('hidden', mode !== 'sector');
    setSettingsAdvancedOpen(mode === 'custom');
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
        'Modo personalizado ativo: ajuste abaixo sua jornada (HH:MM), bônus e validade.';
    }
    updateSettingsRuleSummaryCard();
  }

  function openSettingsModal() {
    lastFocusedEl = document.activeElement;
    populateSettingsSelects();
    const settings = ctx.getSettings();

    const unionSel = document.getElementById('settingUnionCode');
    unionSel.value = findUnionByCode(settings.unionCode) ? settings.unionCode : 'sindpd_sp';

    const sectorSel = document.getElementById('settingCompanySector');
    sectorSel.value = findSectorByCode(settings.companySector) ? settings.companySector : 'tecnologia';

    setSettingsUnionModeUI(settings.unionMode || 'sector');
    document.getElementById('settingStateUf').value = settings.stateUf || 'SP';
    document.getElementById('settingDailyHHMM').value = formatHHMM(settings.dailyMinutes || 480);
    document.getElementById('settingOvertimeMult').value = settings.overtimeMultiplier ?? 1.5;
    document.getElementById('settingHolidayMult').value = settings.holidayMultiplier ?? 1.4;
    document.getElementById('settingExpiryDays').value = settings.expiryDays || 180;

    if (settings.unionMode === 'union') {
      document.getElementById('unionRuleHint').textContent = findUnionByCode(settings.unionCode)?.note || '';
    } else if (settings.unionMode === 'sector') {
      document.getElementById('unionRuleHint').textContent = findSectorByCode(settings.companySector)?.desc || '';
    } else {
      document.getElementById('unionRuleHint').textContent =
        'Modo personalizado ativo: ajuste abaixo sua jornada (HH:MM), bônus e validade.';
    }

    updateSettingsRuleSummaryCard();
    document.getElementById('settingsModal').classList.remove('hidden');
    window.lucide?.createIcons();
    const firstSelect = settings.unionMode === 'union'
      ? document.getElementById('settingUnionCode')
      : document.getElementById('settingCompanySector');
    focusDesktopOnly(firstSelect);
  }

  function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
    restoreLastFocus();
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
  document.getElementById('toggleSettingsAdvancedBtn')?.addEventListener('click', () => {
    const isHidden = document.getElementById('settingsAdvancedBox')?.classList.contains('hidden');
    setSettingsAdvancedOpen(Boolean(isHidden));
  });
  ['settingDailyHHMM', 'settingOvertimeMult', 'settingHolidayMult', 'settingExpiryDays'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateSettingsRuleSummaryCard);
  });

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsedMins = parseDurationToMinutes(document.getElementById('settingDailyHHMM').value, { min: 60, max: 1440 });
    if (parsedMins === null) {
      setSettingsAdvancedOpen(true);
      ctx.showToast('Jornada inválida. Use HH:MM (ex.: 08:00 ou 07:20)');
      return;
    }

    const btn = document.getElementById('settingsSubmitBtn');
    const nextSettings = {
      ...ctx.getSettings(),
      unionMode: getActiveUnionModeFromUI(),
      unionCode: document.getElementById('settingUnionCode').value,
      companySector: document.getElementById('settingCompanySector').value,
      stateUf: document.getElementById('settingStateUf').value || 'SP',
      dailyMinutes: parsedMins,
      overtimeMultiplier: parseFloat(document.getElementById('settingOvertimeMult').value) || 1.0,
      holidayMultiplier: parseFloat(document.getElementById('settingHolidayMult').value) || 1.0,
      expiryDays: parseInt(document.getElementById('settingExpiryDays').value, 10) || 180
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
        ? 'holiday-view-pill min-h-[34px] px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white transition'
        : 'holiday-view-pill min-h-[34px] px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition';
    });
  }

  function syncHolidaysBatchFooterUI() {
    const count = selectedHolidayDates.size;
    const batchSection = document.getElementById('holidayBatchSection');
    const clearBtn = document.getElementById('clearSelectionHolidaysBtn');
    const labelEl = document.getElementById('importSelectedHolidaysLabel');
    if (batchSection) batchSection.classList.toggle('hidden', count === 0);
    if (clearBtn) clearBtn.classList.toggle('hidden', count === 0);
    if (labelEl) labelEl.textContent = `Adicionar Selecionados (${count})`;
  }

  function formatHolidayMetaSubtitle(ufCode, year) {
    if (!ufCode || ufCode === 'NONE') return `Feriados Nacionais • ${year}`;
    const ufObj = BRAZIL_UFS.find((u) => u.code === ufCode);
    return `${ufObj ? ufObj.name : ufCode} • ${year}`;
  }

  function renderHolidaysModalList() {
    const container = document.getElementById('holidaysListContainer');
    const bridgesBanner = document.getElementById('holidayBridgesBanner');
    const entries = ctx.getEntries();
    const settings = ctx.getSettings();
    const uf = document.getElementById('holidayUfSelect').value || getActiveHolidayUf();
    document.getElementById('holidayYearDisplay').textContent = String(holidayYear);

    const bridgeSuggestions = currentHolidayList
      .filter((h) => !h.isPast)
      .map((h) => getHolidayBridgeOpportunity(h, entries))
      .filter((b) => b && !b.alreadyScheduled);

    if (bridgesBanner) {
      if (bridgeSuggestions.length > 0) {
        const previewBtns = bridgeSuggestions.slice(0, 3).map((b) => `
          <button type="button" data-bridge-holiday-date="${b.holidayDate}" data-bridge-date="${b.bridgeDate}" data-bridge-holiday-name="${escapeHtml(b.holidayName)}" class="schedule-bridge-btn px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 hover:bg-amber-100/70 dark:hover:bg-amber-900/50 text-[11px] font-semibold text-amber-900 dark:text-amber-200 transition">
            ${escapeHtml(b.bridgeLabel)} (${formatDateBR(b.bridgeDate).slice(0, 5)}) — ${escapeHtml(b.holidayName)}
          </button>
        `).join('');
        bridgesBanner.innerHTML = `
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="font-bold flex items-center gap-1.5">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0"></i>
              <span>${bridgeSuggestions.length} ${bridgeSuggestions.length === 1 ? 'ponte para emendar feriado' : 'pontes para emendar feriado'} (${formatHHMM(settings.dailyMinutes || 480)}/folga):</span>
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">${previewBtns}</div>
        `;
        bridgesBanner.classList.remove('hidden');
      } else {
        bridgesBanner.classList.add('hidden');
        bridgesBanner.innerHTML = '';
      }
    }

    const visibleItems = currentHolidayList.filter((h) => {
      if (holidayFilter === 'upcoming') return !h.isPast;
      if (holidayFilter === 'available') return !isHolidayAlreadyInEntries(entries, h.date, h.name);
      return true;
    });

    if (!visibleItems.length) {
      container.innerHTML = `<div class="p-8 text-center text-xs text-slate-500 dark:text-slate-400">Nenhum feriado encontrado para o filtro selecionado em ${holidayYear} (${escapeHtml(uf)}).</div>`;
      syncHolidaysBatchFooterUI();
      return;
    }

    container.innerHTML = visibleItems.map((h) => {
      const already = isHolidayAlreadyInEntries(entries, h.date, h.name);
      const checked = !already && selectedHolidayDates.has(h.date);
      const weekend = isWeekendISO(h.date);
      const weekday = getWeekdayShortBR(h.date);
      const bridge = getHolidayBridgeOpportunity(h, entries);

      let timingBadge = '';
      if (h.isToday) {
        timingBadge = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Hoje</span>';
      } else if (!h.isPast && h.daysDiff <= 45) {
        timingBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">Em ${h.daysDiff}d</span>`;
      }

      const scopeTag = h.scope && h.scope !== 'Nacional'
        ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">${escapeHtml(h.scope)}</span>`
        : '';

      const bridgeTag = bridge
        ? (bridge.alreadyScheduled
          ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">Ponte agendada</span>`
          : `<button type="button" data-bridge-holiday-date="${h.date}" data-bridge-date="${bridge.bridgeDate}" data-bridge-holiday-name="${escapeHtml(h.name)}" class="schedule-bridge-btn px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 transition">Ponte (${formatDateBR(bridge.bridgeDate).slice(0, 5)})</button>`)
        : '';

      return `
        <div class="p-3 sm:p-3.5 flex items-center justify-between gap-2.5 sm:gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition min-w-0">
          <div class="min-w-0 flex-1 space-y-1">
            <label class="flex items-start gap-2.5 min-w-0 ${already ? 'cursor-default' : 'cursor-pointer'}">
              <input
                type="checkbox"
                data-holiday-date="${h.date}"
                aria-label="Selecionar ${escapeHtml(h.name)}"
                ${already ? 'disabled' : ''}
                ${checked ? 'checked' : ''}
                class="holiday-checkbox mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 cursor-pointer shrink-0"
              />
              <span class="min-w-0 flex-1 block">
                <span class="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug break-words">${escapeHtml(h.name)}</span>
                <span class="mt-0.5 flex items-center gap-1.5 flex-wrap font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                  <span>${formatDateBR(h.date)} (${weekday})</span>
                  ${scopeTag}
                  ${weekend ? '<span class="font-sans text-[10px] font-medium text-amber-600 dark:text-amber-400">• Fim de semana</span>' : ''}
                  ${timingBadge}
                </span>
              </span>
            </label>
            ${bridgeTag ? `<div class="pl-6">${bridgeTag}</div>` : ''}
          </div>

          <div class="shrink-0 flex items-center">
            ${already
          ? '<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 whitespace-nowrap">Já no extrato</span>'
          : `<button type="button" data-quick-holiday-date="${h.date}" class="quick-add-holiday-btn min-h-[38px] px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-xs font-semibold whitespace-nowrap transition">+ Lançar</button>`
        }
          </div>
        </div>
      `;
    }).join('');

    syncHolidaysBatchFooterUI();
    window.lucide?.createIcons();
  }

  function getHolidayBatchWorkedMinutes() {
    const settings = ctx.getSettings();
    const raw = document.getElementById('holidayBatchHHMM')?.value || '';
    const parsed = parseDurationToMinutes(raw);
    return parsed && parsed > 0 ? parsed : (Number(settings.dailyMinutes) || 480);
  }

  function updateHolidaysRulePreview() {
    const s = ctx.getSettings();
    const hMult = Number(s.holidayMultiplier) || 1.4;
    const workedM = getHolidayBatchWorkedMinutes();
    const creditedM = applyMultiplierToMinutes(workedM, hMult);
    document.getElementById('holidaysRulePreview').textContent =
      `${formatHHMM(workedM)} × ${hMult}x = ${formatHHMM(creditedM, true)} por feriado`;
  }

  async function refreshHolidaysView(forceRefresh = false) {
    const ufSelect = document.getElementById('holidayUfSelect');
    const uf = ufSelect.value || getActiveHolidayUf();
    updateHolidaysRulePreview();

    document.getElementById('holidaysMetaText').textContent = `Carregando ${holidayYear}...`;
    const result = await fetchHolidaysForYear(holidayYear, uf, forceRefresh);
    currentHolidayList = result.items;
    document.getElementById('holidaysMetaText').textContent = formatHolidayMetaSubtitle(result.stateUf, result.year);
    renderHolidaysModalList();
  }

  async function openHolidaysModal() {
    lastFocusedEl = document.activeElement;
    populateSettingsSelects();
    holidayYear = new Date().getFullYear();
    holidayFilter = 'all';
    selectedHolidayDates.clear();
    updateHolidayFilterPillsUI();
    syncHolidaysBatchFooterUI();

    const batchInput = document.getElementById('holidayBatchHHMM');
    if (batchInput) {
      batchInput.value = formatHHMM(Number(ctx.getSettings().dailyMinutes) || 480);
    }

    const uf = getActiveHolidayUf();
    document.getElementById('holidayUfSelect').value = uf;
    document.getElementById('holidaysModal').classList.remove('hidden');
    window.lucide?.createIcons();
    focusDesktopOnly(document.getElementById('holidayUfSelect'));
    await refreshHolidaysView(false);
  }

  function closeHolidaysModal() {
    document.getElementById('holidaysModal').classList.add('hidden');
    restoreLastFocus();
  }

  document.getElementById('closeHolidaysModalBtn').addEventListener('click', closeHolidaysModal);
  document.getElementById('holidaysModal').addEventListener('click', (e) => {
    const bridgeBtn = e.target.closest('.schedule-bridge-btn');
    if (bridgeBtn) {
      const bridgeDate = bridgeBtn.dataset.bridgeDate;
      const holidayDate = bridgeBtn.dataset.bridgeHolidayDate;
      const holidayName = bridgeBtn.dataset.bridgeHolidayName || 'Feriado';
      const settings = ctx.getSettings();
      closeHolidaysModal();
      openEntryModal({
        type: 'debit',
        category: 'time_off',
        date: bridgeDate,
        minutes: settings.dailyMinutes || 480,
        title: `Folga Ponte — ${holidayName}`,
        status: bridgeDate <= getLocalDateISO() ? 'realized' : 'planned',
        notes: `Emenda do feriado de ${formatDateBR(holidayDate)}`
      }, false, { source: 'bridge' });
      return;
    }
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
    syncHolidaysBatchFooterUI();
  });

  document.getElementById('holidayBatchHHMM')?.addEventListener('input', updateHolidaysRulePreview);
  document.getElementById('holidayBatchHHMM')?.addEventListener('blur', (e) => {
    const parsed = parseDurationToMinutes(e.target.value);
    if (parsed && parsed > 0) {
      e.target.value = formatHHMM(parsed);
      updateHolidaysRulePreview();
    }
  });
  document.querySelectorAll('[data-holiday-quick-duration]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.holidayQuickDuration === 'journey'
        ? formatHHMM(Number(ctx.getSettings().dailyMinutes) || 480)
        : btn.dataset.holidayQuickDuration;
      const input = document.getElementById('holidayBatchHHMM');
      if (input) {
        input.value = val;
        updateHolidaysRulePreview();
      }
    });
  });

  document.getElementById('holidaysListContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-add-holiday-btn');
    if (!btn) return;
    const h = currentHolidayList.find((item) => item.date === btn.dataset.quickHolidayDate);
    if (!h) return;
    const settings = ctx.getSettings();
    const workedMins = getHolidayBatchWorkedMinutes();
    closeHolidaysModal();
    openEntryModal({
      type: 'credit',
      category: 'holiday',
      date: h.date,
      title: h.name,
      minutes: workedMins,
      status: h.date <= getLocalDateISO() ? 'realized' : 'planned',
      expiry: addDaysToISO(h.date, settings.expiryDays),
      notes: `Feriado ${h.scope}`
    }, false, { source: 'holiday' });
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

    const batchInput = document.getElementById('holidayBatchHHMM');
    const rawBatch = batchInput?.value?.trim() || '';
    const parsedBatch = rawBatch ? parseDurationToMinutes(rawBatch) : (Number(settings.dailyMinutes) || 480);
    if (!parsedBatch || parsedBatch <= 0) {
      ctx.showToast('Informe uma duração válida em HH:MM (ex.: 08:00 ou 04:00)');
      batchInput?.focus();
      return;
    }

    const btn = document.getElementById('importSelectedHolidaysBtn');
    const mult = Number(settings.holidayMultiplier) || 1.0;
    const workedMins = parsedBatch;
    const creditedMins = applyMultiplierToMinutes(workedMins, mult);
    const todayISO = getLocalDateISO();

    const newEntries = chosen.map((h) => ({
      id: generateUUID(),
      type: 'credit',
      category: 'holiday',
      date: h.date,
      title: h.name,
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
    syncHolidaysBatchFooterUI();
  });

  // ==================== ONBOARDING / SALDO INICIAL ====================
  let initBalanceMode = 'zero'; // 'zero' | 'custom'
  let initBalanceSign = 'credit'; // 'credit' | 'debit'
  let initSelectedUnion = 'sindpd_sp';

  function syncInitialSetupUI() {
    const step1 = document.getElementById('initStep1Box');
    const step2 = document.getElementById('initStep2Box');
    const titleEl = document.getElementById('initialSetupTitle');
    const subtitleEl = document.getElementById('initialSetupSubtitle');
    const customBox = document.getElementById('initCustomBalanceBox');

    const isStep1Visible = step1 && !step1.classList.contains('hidden');
    if (titleEl && subtitleEl) {
      if (isStep1Visible) {
        titleEl.textContent = 'Configuração rápida';
        subtitleEl.textContent = 'Passo 1 de 2 • Escolha sua regra padrão';
      } else if (step1?.dataset.adjustOnly === '1') {
        titleEl.textContent = 'Definir saldo inicial';
        subtitleEl.textContent = 'Informe horas acumuladas anteriores ao app';
      } else {
        titleEl.textContent = 'Saldo anterior';
        subtitleEl.textContent = 'Passo 2 de 2 • Você já tem horas no banco?';
      }
    }

    const zeroCard = document.getElementById('initModeZeroBtn');
    const customCard = document.getElementById('initModeCustomBtn');
    const activeCardCls = 'w-full min-h-[56px] p-3.5 rounded-xl border-2 border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-left transition';
    const inactiveCardCls = 'w-full min-h-[56px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-left transition';
    if (zeroCard) zeroCard.className = initBalanceMode === 'zero' ? activeCardCls : inactiveCardCls;
    if (customCard) customCard.className = initBalanceMode === 'custom' ? activeCardCls : inactiveCardCls;
    customBox?.classList.toggle('hidden', initBalanceMode !== 'custom');

    const posBtn = document.getElementById('initSignCreditBtn');
    const negBtn = document.getElementById('initSignDebitBtn');
    if (posBtn && negBtn) {
      posBtn.className = initBalanceSign === 'credit'
        ? 'min-h-[42px] px-3 py-2 rounded-xl border border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition'
        : 'min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold transition';
      negBtn.className = initBalanceSign === 'debit'
        ? 'min-h-[42px] px-3 py-2 rounded-xl border border-rose-500 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-bold transition'
        : 'min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold transition';
    }
  }

  function openInitialSetupModal({ startStep = 1, adjustOnly = false } = {}) {
    lastFocusedEl = document.activeElement;
    const modal = document.getElementById('initialSetupModal');
    if (!modal) return;

    populateSettingsSelects();
    const s = ctx.getSettings();
    initSelectedUnion = findUnionByCode(s.unionCode) ? s.unionCode : 'sindpd_sp';

    const unionSel = document.getElementById('initUnionSelect');
    if (unionSel) {
      unionSel.innerHTML = UNION_CATALOG.map((u) => `<option value="${u.code}">${escapeHtml(u.name)}</option>`).join('');
      unionSel.value = initSelectedUnion;
    }

    const existingInitial = ctx.getEntries().find((e) => isInitialBalanceEntry(e));
    if (existingInitial) {
      initBalanceMode = 'custom';
      initBalanceSign = existingInitial.type === 'debit' ? 'debit' : 'credit';
      const total = Math.max(0, Math.round(Number(existingInitial.minutes) || 0));
      document.getElementById('initHoursPart').value = String(Math.floor(total / 60)).padStart(2, '0');
      document.getElementById('initMinutesPart').value = String(total % 60).padStart(2, '0');
    } else {
      initBalanceMode = 'zero';
      initBalanceSign = 'credit';
      document.getElementById('initHoursPart').value = '00';
      document.getElementById('initMinutesPart').value = '00';
    }

    const step1 = document.getElementById('initStep1Box');
    const step2 = document.getElementById('initStep2Box');
    if (step1 && step2) {
      step1.dataset.adjustOnly = adjustOnly ? '1' : '0';
      step1.classList.toggle('hidden', startStep === 2);
      step2.classList.toggle('hidden', startStep !== 2);
      document.getElementById('initBackToStep1Btn')?.classList.toggle('hidden', adjustOnly);
    }

    syncInitialSetupUI();
    modal.classList.remove('hidden');
    window.lucide?.createIcons();
    focusDesktopOnly(startStep === 1 ? unionSel : document.getElementById('initModeZeroBtn'));
  }

  function closeInitialSetupModal(markDone = true) {
    const modal = document.getElementById('initialSetupModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (markDone) ctx.onOnboardingCompleted?.();
    restoreLastFocus();
  }

  document.getElementById('closeInitialSetupBtn')?.addEventListener('click', () => closeInitialSetupModal(true));
  document.getElementById('initSkipBtn')?.addEventListener('click', () => closeInitialSetupModal(true));
  document.getElementById('initialSetupModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'initialSetupModal') closeInitialSetupModal(true);
  });

  document.getElementById('initNextToStep2Btn')?.addEventListener('click', async () => {
    const unionCode = document.getElementById('initUnionSelect')?.value || 'sindpd_sp';
    const u = findUnionByCode(unionCode);
    if (u) {
      const nextSettings = {
        ...ctx.getSettings(),
        unionMode: 'union',
        unionCode: u.code,
        companySector: u.sector || ctx.getSettings().companySector,
        dailyMinutes: u.dailyMinutes,
        overtimeMultiplier: u.overtimeMultiplier,
        holidayMultiplier: u.holidayMultiplier,
        expiryDays: u.expiryDays,
        stateUf: u.stateUf || ctx.getSettings().stateUf
      };
      await ctx.saveSettings(nextSettings, { silentToast: true });
    }
    document.getElementById('initStep1Box')?.classList.add('hidden');
    document.getElementById('initStep2Box')?.classList.remove('hidden');
    syncInitialSetupUI();
  });

  document.getElementById('initBackToStep1Btn')?.addEventListener('click', () => {
    document.getElementById('initStep2Box')?.classList.add('hidden');
    document.getElementById('initStep1Box')?.classList.remove('hidden');
    syncInitialSetupUI();
  });

  document.getElementById('initModeZeroBtn')?.addEventListener('click', () => {
    initBalanceMode = 'zero';
    syncInitialSetupUI();
  });
  document.getElementById('initModeCustomBtn')?.addEventListener('click', () => {
    initBalanceMode = 'custom';
    syncInitialSetupUI();
    document.getElementById('initHoursPart')?.focus();
  });
  document.getElementById('initSignCreditBtn')?.addEventListener('click', () => {
    initBalanceSign = 'credit';
    syncInitialSetupUI();
  });
  document.getElementById('initSignDebitBtn')?.addEventListener('click', () => {
    initBalanceSign = 'debit';
    syncInitialSetupUI();
  });

  ['initHoursPart', 'initMinutesPart'].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D/g, '');
      if (input.value !== clean) input.value = clean;
    });
    input.addEventListener('blur', () => {
      const v = parseInt(input.value, 10) || 0;
      const clamped = id === 'initHoursPart' ? Math.min(999, Math.max(0, v)) : Math.min(59, Math.max(0, v));
      input.value = String(clamped).padStart(2, '0');
    });
  });

  document.getElementById('saveInitialSetupBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveInitialSetupBtn');
    const existingInitial = ctx.getEntries().find((e) => isInitialBalanceEntry(e));

    if (initBalanceMode === 'zero') {
      if (existingInitial && typeof ctx.removeEntryQuiet === 'function') {
        await runWithButtonLoading(btn, 'Salvando...', async () => {
          const ok = await ctx.removeEntryQuiet(existingInitial.id);
          if (ok) {
            ctx.showToast('Saldo inicial zerado!');
            closeInitialSetupModal(true);
          }
        });
      } else {
        ctx.showToast('Configuração inicial concluída!');
        closeInitialSetupModal(true);
      }
      return;
    }

    const hh = Math.max(0, parseInt(document.getElementById('initHoursPart')?.value, 10) || 0);
    const mm = Math.min(59, Math.max(0, parseInt(document.getElementById('initMinutesPart')?.value, 10) || 0));
    const totalMins = hh * 60 + mm;
    if (totalMins <= 0) {
      ctx.showToast('Informe um saldo inicial maior que 00:00');
      return;
    }

    const s = ctx.getSettings();
    const todayIso = getLocalDateISO();
    const entryObj = {
      id: existingInitial?.id || generateUUID(),
      type: initBalanceSign,
      date: existingInitial?.date || todayIso,
      minutes: totalMins,
      workedMinutes: totalMins,
      multiplier: 1.0,
      category: 'adjustment',
      title: 'Saldo inicial informado',
      status: 'realized',
      expiry: initBalanceSign === 'credit' ? (existingInitial?.expiry || addDaysToISO(todayIso, s.expiryDays)) : '',
      notes: 'Saldo Inicial • Ajustado manualmente pelo usuário',
      createdAt: existingInitial?.createdAt || new Date().toISOString()
    };

    await runWithButtonLoading(btn, 'Salvando...', async () => {
      const ok = await ctx.saveEntry(entryObj);
      if (ok) closeInitialSetupModal(true);
    });
  });

  // ==================== MODAL: ENCERRAMENTO / BAIXA DE CRÉDITO EXPIRADO ====================
  let writeOffTarget = null;
  let writeOffReason = 'expired'; // 'expired' | 'settled'

  function syncWriteOffReasonUI() {
    const expBtn = document.getElementById('writeOffReasonExpiredBtn');
    const setBtn = document.getElementById('writeOffReasonSettledBtn');
    const activeCls = 'w-full min-h-[56px] p-3.5 rounded-xl border-2 border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-left transition';
    const inactiveCls = 'w-full min-h-[56px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-left transition';
    if (expBtn) expBtn.className = writeOffReason === 'expired' ? activeCls : inactiveCls;
    if (setBtn) setBtn.className = writeOffReason === 'settled' ? activeCls : inactiveCls;
  }

  function openWriteOffModal(entryItem, remainingMinutes) {
    if (!entryItem || entryItem.type !== 'credit') return;
    const remMins = Math.max(0, Math.round(Number(remainingMinutes) || 0));
    if (remMins <= 0) {
      ctx.showToast('Este crédito já foi totalmente compensado.');
      return;
    }

    lastFocusedEl = document.activeElement;
    writeOffTarget = { entry: entryItem, remainingMinutes: remMins };
    writeOffReason = 'expired';

    const summaryEl = document.getElementById('writeOffSummaryText');
    if (summaryEl) {
      summaryEl.textContent =
        `Crédito "${entryItem.title}" (${formatDateBR(entryItem.date)}) com saldo restante de ${formatHHMM(remMins)}. Escolha como deseja encerrar:`;
    }
    syncWriteOffReasonUI();
    document.getElementById('writeOffModal')?.classList.remove('hidden');
    window.lucide?.createIcons();
    focusDesktopOnly(document.getElementById('writeOffReasonExpiredBtn'));
  }

  function closeWriteOffModal() {
    document.getElementById('writeOffModal')?.classList.add('hidden');
    writeOffTarget = null;
    restoreLastFocus();
  }

  document.getElementById('closeWriteOffModalBtn')?.addEventListener('click', closeWriteOffModal);
  document.getElementById('cancelWriteOffModalBtn')?.addEventListener('click', closeWriteOffModal);
  document.getElementById('writeOffModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'writeOffModal') closeWriteOffModal();
  });
  document.getElementById('writeOffReasonExpiredBtn')?.addEventListener('click', () => {
    writeOffReason = 'expired';
    syncWriteOffReasonUI();
  });
  document.getElementById('writeOffReasonSettledBtn')?.addEventListener('click', () => {
    writeOffReason = 'settled';
    syncWriteOffReasonUI();
  });

  document.getElementById('confirmWriteOffBtn')?.addEventListener('click', async () => {
    if (!writeOffTarget) return;
    const btn = document.getElementById('confirmWriteOffBtn');
    const { entry, remainingMinutes } = writeOffTarget;
    const cleanTitle = String(entry.title || '').replace(/\s*\((?:Plantão\/Feriado|Feriado)\)\s*$/i, '').trim() || entry.title;
    const isExpiredReason = writeOffReason === 'expired';
    const writeOffDate = getLocalDateISO() >= entry.date ? getLocalDateISO() : entry.date;

    const writeOffEntry = {
      id: generateUUID(),
      type: 'debit',
      date: writeOffDate,
      minutes: remainingMinutes,
      workedMinutes: remainingMinutes,
      multiplier: 1.0,
      category: 'adjustment',
      title: isExpiredReason
        ? `Baixa por vencimento — ${cleanTitle}`
        : `Fechamento de ciclo — ${cleanTitle}`,
      status: 'realized',
      expiry: '',
      notes: isExpiredReason
        ? `Expirou sem uso (ref. ${formatDateBR(entry.date)})`
        : `Pago / Zerado no fechamento (ref. ${formatDateBR(entry.date)})`,
      createdAt: new Date().toISOString()
    };

    await runWithButtonLoading(btn, 'Aplicando baixa...', async () => {
      const ok = await ctx.saveEntry(writeOffEntry);
      if (ok) {
        ctx.showToast(`Baixa de ${formatHHMM(remainingMinutes)} registrada!`);
        closeWriteOffModal();
      }
    });
  });

  return {
    confirmDialog,
    resolveConfirm,
    openShortcutsModal,
    closeShortcutsModal,
    openEntryIntentModal,
    closeEntryIntentModal,
    openEntryModal,
    closeEntryModal,
    openSettingsModal,
    closeSettingsModal,
    openHolidaysModal,
    closeHolidaysModal,
    openInitialSetupModal,
    closeInitialSetupModal,
    openWriteOffModal,
    closeWriteOffModal,
    captureLastFocus,
    restoreLastFocus,
    hasOpenModal: () => Boolean(getOpenModalElement()),
    registerExternalModal(id, closeFn) {
      if (id && typeof closeFn === 'function') {
        externalModals.push({ id, closeFn });
      }
    },
    handleEscapeKey() {
      if (!document.getElementById('confirmModal').classList.contains('hidden')) {
        resolveConfirm(false);
        return true;
      }
      if (!document.getElementById('writeOffModal')?.classList.contains('hidden')) {
        closeWriteOffModal();
        return true;
      }
      if (!document.getElementById('initialSetupModal')?.classList.contains('hidden')) {
        closeInitialSetupModal(true);
        return true;
      }
      if (!document.getElementById('shortcutsModal').classList.contains('hidden')) {
        closeShortcutsModal();
        return true;
      }
      if (!document.getElementById('entryIntentModal')?.classList.contains('hidden')) {
        closeEntryIntentModal({ restoreFocus: true });
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
      for (const ext of externalModals) {
        const el = document.getElementById(ext.id);
        if (el && !el.classList.contains('hidden')) {
          ext.closeFn();
          return true;
        }
      }
      return false;
    }
  };
}
