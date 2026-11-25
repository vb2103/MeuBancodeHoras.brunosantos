import { setupAuth } from './auth.js';
import { destroyCharts, renderCharts } from './charts.js';
import { ENTRY_CATEGORIES, STORAGE_KEYS, escapeHtml, formatDateBR, getLocalDateISO } from './config.js';
import {
  createDefaultSettings,
  deleteEntryFromCloud,
  loadUserDataFromCloud,
  saveSettingsToCloud,
  upsertEntriesBatchToCloud,
  upsertEntryToCloud,
  validateAndNormalizeImportedEntries
} from './db.js';
import {
  buildCalendarEventsFromEntries,
  buildCommunicationTemplates,
  computeIntegrityDigest,
  copyElementText,
  downloadIcsEvents,
  exportCSV,
  exportExcelXML,
  exportJSONBackup,
  exportPDF,
  exportStructuredXML
} from './export.js';
import { createExportModalManager } from './export-modal.js';
import { createModalManager } from './modals.js';
import { createProfileManager } from './profile.js';
import { getActiveRuleSummary } from './rules-catalog.js';
import { getUserInitials } from './security.js';
import {
  computeChronologicalAndFIFO,
  formatDaysFromMinutes,
  formatHHMM,
  getExpiryBadge,
  isHolidayEntry
} from './time.js';

// ==================== ESTADO DA APLICAÇÃO ====================
let currentUser = null;
let sortAscending = true;
let quickFilter = 'all';
let analyticsBalanceScope = 'all'; // 'all' | 'realized'
let analyticsRatioMode = 'composition'; // 'composition' | 'origin'
let settings = createDefaultSettings();
let entries = [];
let toastTimer = null;

// ==================== TOAST & SYNC BADGE ====================
function showToast(msg, options = {}) {
  const { actionLabel = null, onAction = null, duration = 3000 } = options || {};
  const toast = document.getElementById('toast');
  const actionBtn = document.getElementById('toastActionBtn');
  document.getElementById('toastMsg').textContent = msg;

  if (actionBtn) {
    if (actionLabel && typeof onAction === 'function') {
      actionBtn.textContent = actionLabel;
      actionBtn.classList.remove('hidden');
      actionBtn.onclick = async () => {
        actionBtn.disabled = true;
        clearTimeout(toastTimer);
        toast.classList.add('hidden');
        toast.classList.remove('flex');
        actionBtn.classList.add('hidden');
        actionBtn.disabled = false;
        await onAction();
      };
    } else {
      actionBtn.classList.add('hidden');
      actionBtn.onclick = null;
    }
  }

  toast.classList.remove('hidden');
  toast.classList.add('flex');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('flex');
    if (actionBtn) {
      actionBtn.classList.add('hidden');
      actionBtn.onclick = null;
    }
  }, duration);
}

const SYNC_STATUS_STYLES = {
  saving: {
    text: 'Salvando...',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70'
  },
  offline: {
    text: 'Modo Offline',
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70'
  },
  error: {
    text: 'Erro ao sincronizar',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70'
  },
  ok: {
    text: 'Nuvem Ativa',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70'
  }
};

function setSyncStatus(state) {
  const badge = document.getElementById('syncBadge');
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (!badge || !text) return;

  const cfg = SYNC_STATUS_STYLES[state] || SYNC_STATUS_STYLES.ok;
  text.textContent = cfg.text;
  badge.title = cfg.text;
  badge.setAttribute('aria-label', `Sincronização: ${cfg.text}`);
  badge.className = `inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0 ${cfg.badge}`;
  if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${cfg.dot}`;
}

// ==================== TEMA CLARO / ESCURO ====================
function syncThemeMobileLabel() {
  const lbl = document.getElementById('profileMobileThemeLabel');
  if (!lbl) return;
  const isDark = document.documentElement.classList.contains('dark');
  lbl.textContent = isDark ? 'Tema Claro' : 'Tema Escuro';
}

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', savedTheme === 'dark' || (!savedTheme && prefersDark));
  syncThemeMobileLabel();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
  syncThemeMobileLabel();
  if (!document.getElementById('tabPanel-graficos').classList.contains('hidden')) {
    renderAnalyticsTab();
  }
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);
document.getElementById('authThemeToggle').addEventListener('click', toggleTheme);

async function persistSettings(nextSettings, { silentToast = false } = {}) {
  if (!currentUser) return false;
  const prevSettings = { ...settings };
  settings = nextSettings;

  try {
    await saveSettingsToCloud(currentUser.id, settings, setSyncStatus);
    updateHeaderUserInfo();
    renderAll();
    if (!silentToast) showToast('Parâmetros salvos na nuvem!');
    return true;
  } catch {
    settings = prevSettings;
    updateHeaderUserInfo();
    renderAll();
    showToast('Erro ao salvar parâmetros — revertido');
    return false;
  }
}

// ==================== MODAIS PRÓPRIOS & TRANSAÇÕES ====================
const modals = createModalManager({
  getSettings: () => settings,
  getEntries: () => entries,
  showToast,
  async saveEntry(entryObj) {
    if (!currentUser) return false;
    const snapshot = [...entries];
    const idx = entries.findIndex((item) => item.id === entryObj.id);
    if (idx >= 0) entries[idx] = entryObj;
    else entries.push(entryObj);

    try {
      await upsertEntryToCloud(currentUser.id, entryObj, setSyncStatus);
      renderAll();
      showToast('Lançamento salvo na nuvem!');
      return true;
    } catch {
      entries = snapshot;
      renderAll();
      showToast('Falha ao salvar na nuvem — alteração revertida');
      return false;
    }
  },
  async addEntriesBatch(newEntries) {
    if (!currentUser || !newEntries.length) return false;
    const snapshot = [...entries];
    entries = [...entries, ...newEntries];

    try {
      await upsertEntriesBatchToCloud(currentUser.id, newEntries, setSyncStatus);
      renderAll();
      return true;
    } catch {
      entries = snapshot;
      renderAll();
      showToast('Erro ao importar para a nuvem — revertido');
      return false;
    }
  },
  saveSettings: persistSettings
});

// ==================== CABEÇALHO & FILTROS ====================
function updateHeaderUserInfo() {
  const displayName = settings.userName || currentUser?.user_metadata?.full_name || currentUser?.email || 'Usuário';
  const ruleLabel = getActiveRuleSummary(settings);
  document.getElementById('headerSubtitle').textContent =
    `${displayName} • ${ruleLabel} (${settings.stateUf || 'SP'}) • Jornada ${formatHHMM(settings.dailyMinutes)}`;
  document.getElementById('settingsUserEmail').textContent = currentUser?.email || '—';

  const avatarEl = document.getElementById('headerProfileAvatar');
  const labelEl = document.getElementById('headerProfileLabel');
  if (avatarEl) avatarEl.textContent = getUserInitials(displayName, currentUser?.email || '');
  if (labelEl) labelEl.textContent = String(displayName).split(/\s+/)[0] || 'Perfil';
}

function populateYearFilterOptions() {
  const yearSelect = document.getElementById('yearFilter');
  const prevValue = yearSelect.value || 'all';
  const yearsSet = new Set([String(new Date().getFullYear())]);
  entries.forEach((e) => {
    if (e.date && e.date.length >= 4) yearsSet.add(e.date.slice(0, 4));
  });
  const sortedYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));

  yearSelect.innerHTML = '<option value="all">Todos os anos</option>' +
    sortedYears.map((y) => `<option value="${y}">${y}</option>`).join('');

  yearSelect.value = Array.from(yearSelect.options).some((opt) => opt.value === prevValue)
    ? prevValue
    : 'all';
}

function formatSimulatedDaysLabel(simDays) {
  if (simDays === 0.5) return '0,5 dia (meio período)';
  if (simDays === 1) return '1 dia';
  return `${String(simDays).replace('.', ',')} dias`;
}

function renderAnalyticsTab() {
  const { chrono, remainingMap } = computeChronologicalAndFIFO(entries);
  renderCharts(chrono, remainingMap, settings, {
    balanceScope: analyticsBalanceScope,
    ratioMode: analyticsRatioMode
  });
  window.lucide?.createIcons();
}

function updateSimulator(cachedProjectedMins = null) {
  const projectedMins = cachedProjectedMins !== null
    ? cachedProjectedMins
    : entries.reduce((acc, item) => acc + (item.type === 'credit' ? Number(item.minutes) : -Number(item.minutes)), 0);

  const dailyMins = Math.max(60, Number(settings.dailyMinutes) || 480);
  const slider = document.getElementById('simDaysSlider');
  const maxSuggestedDays = Math.max(15, Math.min(60, Math.ceil(Math.max(0, projectedMins) / dailyMins) + 5));
  slider.max = String(maxSuggestedDays);
  if (parseFloat(slider.value) > maxSuggestedDays) slider.value = String(maxSuggestedDays);

  const simDays = Math.max(0.5, parseFloat(slider.value) || 1);
  const simMins = Math.round(simDays * dailyMins);
  const remainingMins = projectedMins - simMins;

  document.getElementById('simDaysValue').textContent = `${formatSimulatedDaysLabel(simDays)} (${formatHHMM(-simMins)})`;
  document.getElementById('simRemainingResult').textContent =
    `${formatHHMM(remainingMins, true)} (${formatDaysFromMinutes(remainingMins, dailyMins)})`;

  const negWarning = document.getElementById('simNegativeWarning');
  if (negWarning) {
    if (remainingMins < 0) {
      negWarning.textContent = `Atenção: com essa folga você ficaria devendo ${formatHHMM(Math.abs(remainingMins))} no banco de horas.`;
      negWarning.classList.remove('hidden');
    } else {
      negWarning.classList.add('hidden');
    }
  }
}

function getFilteredEntriesState() {
  const { chrono, remainingMap, urgentItems, summary } = computeChronologicalAndFIFO(entries);
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const yearF = document.getElementById('yearFilter').value;
  const typeF = document.getElementById('typeFilter').value;
  const statusF = document.getElementById('statusFilter').value;

  const hasActiveFilters = Boolean(query) || yearF !== 'all' || typeF !== 'all' || statusF !== 'all' || quickFilter !== 'all';

  const filtered = chrono.filter((item) => {
    if (yearF !== 'all' && !item.date.startsWith(`${yearF}-`)) return false;
    if (typeF !== 'all' && item.type !== typeF) return false;
    if (statusF !== 'all' && item.status !== statusF) return false;
    if (quickFilter === 'credits' && item.type !== 'credit') return false;
    if (quickFilter === 'debits' && item.type !== 'debit') return false;
    if (quickFilter === 'planned' && item.status !== 'planned') return false;
    if (quickFilter === 'holidays' && !isHolidayEntry(item)) return false;
    if (quickFilter === 'thismonth') {
      const thisMonth = getLocalDateISO().slice(0, 7);
      if (!item.date.startsWith(thisMonth)) return false;
    }
    if (quickFilter === 'expiring') {
      const rem = remainingMap.get(item.id) ?? 0;
      const badge = getExpiryBadge(item.expiry, rem, getLocalDateISO(), item.minutes);
      if (item.type !== 'credit' || !badge.isAlert) return false;
    }
    if (query) {
      const catLabel = ENTRY_CATEGORIES[item.category]?.label || '';
      const hay = `${item.title} ${item.notes || ''} ${catLabel} ${formatDateBR(item.date)}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return { chrono, remainingMap, urgentItems, summary, filtered, hasActiveFilters };
}

function buildCategoryBadgeHtml(item, extraClass = 'ml-1.5') {
  if (!item.category || item.category === 'manual') return '';
  const label = ENTRY_CATEGORIES[item.category]?.label || item.category;
  return `<span class="inline-block ${extraClass} px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">${escapeHtml(label)}</span>`;
}

function buildWorkedSubtextHtml(item) {
  if (item.type !== 'credit') return '';
  const worked = Number(item.workedMinutes);
  const mult = Number(item.multiplier || 1);
  if (!worked || (worked === Number(item.minutes) && mult === 1)) return '';
  return `<div class="text-[10px] font-normal text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">Trab. ${formatHHMM(worked)} × ${mult}x</div>`;
}

function buildActionButtonsHtml(item) {
  const safeId = escapeHtml(item.id);
  const safeTitle = escapeHtml(item.title);
  const quickConfirm = item.status === 'planned'
    ? `<button type="button" data-confirm-id="${safeId}" aria-label="Confirmar ${safeTitle} como realizado" title="Marcar como realizado" class="confirm-realized-btn p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50 transition"><i data-lucide="check" class="w-4 h-4"></i></button>`
    : '';
  const icsBtn = item.status === 'planned'
    ? `<button type="button" data-ics-id="${safeId}" aria-label="Adicionar ${safeTitle} na agenda (.ics)" title="Baixar evento .ICS" class="ics-entry-btn p-1.5 rounded-lg text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/50 transition"><i data-lucide="calendar-plus" class="w-4 h-4"></i></button>`
    : '';
  return `
    ${quickConfirm}
    ${icsBtn}
    <button type="button" data-edit-id="${safeId}" aria-label="Editar lançamento ${safeTitle}" title="Editar" class="edit-entry-btn p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition">
      <i data-lucide="pencil" class="w-4 h-4"></i>
    </button>
    <button type="button" data-delete-id="${safeId}" aria-label="Excluir lançamento ${safeTitle}" title="Excluir" class="delete-entry-btn p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition">
      <i data-lucide="trash-2" class="w-4 h-4"></i>
    </button>
  `;
}

// ==================== RENDERIZAÇÃO PRINCIPAL ====================
function renderAll() {
  populateYearFilterOptions();
  const { chrono, remainingMap, urgentItems, summary, filtered, hasActiveFilters } = getFilteredEntriesState();
  const todayISO = getLocalDateISO();

  const realizedEl = document.getElementById('kpiRealizedHours');
  realizedEl.textContent = formatHHMM(summary.realizedMinutes, true);
  if (summary.realizedMinutes > 0) {
    realizedEl.className = 'text-xl md:text-2xl lg:text-3xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400';
  } else if (summary.realizedMinutes < 0) {
    realizedEl.className = 'text-xl md:text-2xl lg:text-3xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400';
  } else {
    realizedEl.className = 'text-xl md:text-2xl lg:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white';
  }
  document.getElementById('kpiRealizedDays').textContent = formatDaysFromMinutes(summary.realizedMinutes, settings.dailyMinutes);

  const projEl = document.getElementById('kpiProjectedHours');
  projEl.textContent = formatHHMM(summary.projectedMinutes, true);
  if (summary.projectedMinutes < 0) {
    projEl.className = 'text-xl md:text-2xl lg:text-3xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400';
  } else if (summary.projectedMinutes > 0) {
    projEl.className = 'text-xl md:text-2xl lg:text-3xl font-extrabold font-mono tabular-nums text-indigo-600 dark:text-indigo-400';
  } else {
    projEl.className = 'text-xl md:text-2xl lg:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white';
  }
  document.getElementById('kpiProjectedDays').textContent = formatDaysFromMinutes(summary.projectedMinutes, settings.dailyMinutes);
  document.getElementById('kpiCreditsHours').textContent = formatHHMM(summary.creditsMinutes, true);
  document.getElementById('kpiCreditsCount').textContent = `${summary.creditsCount} ${summary.creditsCount === 1 ? 'registro' : 'registros'}`;
  document.getElementById('kpiDebitsHours').textContent = formatHHMM(-summary.debitsMinutes, false);
  document.getElementById('kpiDebitsCount').textContent = `${summary.debitsCount} ${summary.debitsCount === 1 ? 'folga' : 'folgas'}`;
  document.getElementById('kpiJourneyLabel').textContent = `${formatHHMM(settings.dailyMinutes)}/dia`;

  const alertBanner = document.getElementById('expiryAlertBanner');
  if (urgentItems.length > 0 && summary.projectedMinutes > 0) {
    alertBanner.classList.remove('hidden');
    const totalUrgentMins = urgentItems.reduce((s, i) => s + i.remainingMinutes, 0);
    document.getElementById('expiryAlertText').textContent =
      `Atenção: Você possui ${urgentItems.length} ${urgentItems.length === 1 ? 'crédito não compensado' : 'créditos não compensados'} (${formatHHMM(totalUrgentMins)}) com vencimento próximo ou expirado.`;
  } else {
    alertBanner.classList.add('hidden');
  }

  document.getElementById('clearFiltersBtn').classList.toggle('hidden', !hasActiveFilters);

  const visibleRows = sortAscending ? filtered : [...filtered].reverse();

  document.getElementById('filterCounter').textContent =
    `${visibleRows.length} de ${chrono.length} ${chrono.length === 1 ? 'registro' : 'registros'}`;

  const tbody = document.getElementById('entriesTableBody');
  const mobileContainer = document.getElementById('mobileCardsContainer');
  const emptyState = document.getElementById('emptyState');
  const emptyOnboarding = document.getElementById('emptyOnboarding');
  const emptyFiltered = document.getElementById('emptyFiltered');

  if (visibleRows.length === 0) {
    tbody.innerHTML = '';
    mobileContainer.innerHTML = '';
    emptyState.classList.remove('hidden');
    if (emptyOnboarding && emptyFiltered) {
      emptyOnboarding.classList.toggle('hidden', chrono.length > 0);
      emptyFiltered.classList.toggle('hidden', chrono.length === 0);
    }
  } else {
    emptyState.classList.add('hidden');

    tbody.innerHTML = visibleRows.map((item) => {
      const isCredit = item.type === 'credit';
      const isRealized = item.status === 'realized';
      const remMins = remainingMap.get(item.id) ?? item.minutes;
      const expInfo = isCredit ? getExpiryBadge(item.expiry, remMins, todayISO, item.minutes) : { label: '—', badgeClass: 'text-slate-400' };
      const multTag = isCredit && item.multiplier && Number(item.multiplier) !== 1
        ? `<span class="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 ml-1">(${item.multiplier}x)</span>`
        : '';
      const catBadge = buildCategoryBadgeHtml(item);
      const workedSub = buildWorkedSubtextHtml(item);

      return `
        <tr class="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition group">
          <td class="py-3.5 px-4 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">${formatDateBR(item.date)}</td>
          <td class="py-3.5 px-4">
            <div class="font-semibold text-slate-900 dark:text-white flex items-center flex-wrap gap-y-1">
              <span>${escapeHtml(item.title)}</span>${catBadge}
            </div>
            ${item.notes ? `<div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">${escapeHtml(item.notes)}</div>` : ''}
          </td>
          <td class="py-3.5 px-4 whitespace-nowrap">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${isRealized ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'}">
              <span class="w-1.5 h-1.5 rounded-full ${isRealized ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
              ${isRealized ? 'Realizado' : 'Previsto'}
            </span>
          </td>
          <td class="py-3.5 px-4 text-right font-mono text-xs font-bold tabular-nums whitespace-nowrap ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
            <div>${formatHHMM(item.deltaMinutes, true)}${multTag}</div>
            ${workedSub}
          </td>
          <td class="py-3.5 px-4 text-right font-mono text-xs font-bold tabular-nums whitespace-nowrap text-slate-800 dark:text-slate-200">
            ${formatHHMM(item.runningMinutes, true)}
          </td>
          <td class="py-3.5 px-4 whitespace-nowrap">
            ${isCredit && item.expiry
          ? `<span class="inline-block px-2 py-0.5 rounded-md border text-[11px] font-medium tabular-nums ${expInfo.badgeClass}">${expInfo.label}</span>`
          : '<span class="text-xs text-slate-400">—</span>'}
          </td>
          <td class="py-3.5 px-4 text-right whitespace-nowrap">
            <div class="inline-flex items-center gap-1">
              ${buildActionButtonsHtml(item)}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    mobileContainer.innerHTML = visibleRows.map((item) => {
      const isCredit = item.type === 'credit';
      const isRealized = item.status === 'realized';
      const remMins = remainingMap.get(item.id) ?? item.minutes;
      const expInfo = isCredit ? getExpiryBadge(item.expiry, remMins, todayISO, item.minutes) : null;
      const multTag = isCredit && item.multiplier && Number(item.multiplier) !== 1
        ? ` <span class="text-[11px] font-normal text-indigo-500">(${item.multiplier}x)</span>`
        : '';
      const catBadge = buildCategoryBadgeHtml(item, '');
      const workedSub = buildWorkedSubtextHtml(item);

      const borderAccent = isCredit
        ? 'border-l-4 border-l-emerald-500 dark:border-l-emerald-500'
        : 'border-l-4 border-l-rose-500 dark:border-l-rose-500';

      return `
        <div class="bg-white dark:bg-slate-900 border-y border-r border-slate-200 dark:border-slate-800 ${borderAccent} rounded-2xl p-3.5 shadow-sm space-y-2.5 min-w-0 overflow-hidden">
          <div class="flex items-start justify-between gap-2.5 min-w-0">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">${formatDateBR(item.date)}</span>
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium ${isRealized ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'}">
                  ${isRealized ? 'Realizado' : 'Previsto'}
                </span>
                ${catBadge}
              </div>
              <h4 class="font-bold text-sm text-slate-900 dark:text-white mt-1 break-words">${escapeHtml(item.title)}</h4>
              ${item.notes ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">${escapeHtml(item.notes)}</p>` : ''}
            </div>
            <div class="text-right shrink-0">
              <div class="font-mono text-sm font-extrabold tabular-nums whitespace-nowrap ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
                ${formatHHMM(item.deltaMinutes, true)}${multTag}
              </div>
              ${workedSub}
            </div>
          </div>

          <div class="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between text-xs gap-2 min-w-0">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-slate-500 dark:text-slate-400 whitespace-nowrap">Saldo: <strong class="font-mono tabular-nums text-slate-800 dark:text-slate-200">${formatHHMM(item.runningMinutes, true)}</strong></span>
              ${expInfo && item.expiry ? `<span class="px-2 py-0.5 rounded border text-[10px] font-medium tabular-nums max-w-full ${expInfo.badgeClass}">Venc: ${expInfo.label}</span>` : ''}
            </div>
            <div class="flex items-center gap-1 shrink-0 ml-auto">
              ${buildActionButtonsHtml(item)}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateSimulator(summary.projectedMinutes);
  const { emailText, whatsappText } = buildCommunicationTemplates(chrono, settings);
  document.getElementById('emailTemplate').value = emailText;
  document.getElementById('whatsappTemplate').value = whatsappText;

  if (!document.getElementById('tabPanel-graficos').classList.contains('hidden')) {
    renderAnalyticsTab();
  }
  window.lucide?.createIcons();
}

// ==================== DELEGAÇÃO DE AÇÕES NO EXTRATO ====================
async function handleConfirmRealized(id, btn) {
  if (!btn || btn.dataset.busy === '1' || !currentUser) return;
  const target = entries.find((e) => e.id === id);
  if (!target || target.status === 'realized') return;

  btn.dataset.busy = '1';
  btn.disabled = true;

  const snapshot = [...entries];
  const updated = { ...target, status: 'realized' };
  entries = entries.map((e) => (e.id === id ? updated : e));
  renderAll();

  try {
    await upsertEntryToCloud(currentUser.id, updated, setSyncStatus);
    showToast(`"${updated.title}" marcado como realizado!`);
  } catch {
    entries = snapshot;
    renderAll();
    showToast('Erro ao confirmar na nuvem — alteração revertida');
  }
}

async function handleDeleteEntry(id) {
  const item = entries.find((e) => e.id === id);
  if (!item || !currentUser) return;

  const confirmed = await modals.confirmDialog({
    title: 'Excluir lançamento?',
    message: `Deseja realmente excluir "${item.title}" (${formatDateBR(item.date)} • ${formatHHMM(item.minutes)}) da nuvem?`,
    confirmText: 'Sim, excluir',
    cancelText: 'Cancelar',
    variant: 'danger'
  });
  if (!confirmed) return;

  const deletedItem = { ...item };
  const snapshot = [...entries];
  entries = entries.filter((e) => e.id !== id);
  renderAll();

  try {
    await deleteEntryFromCloud(currentUser.id, id, setSyncStatus);
    showToast(`"${deletedItem.title}" excluído`, {
      actionLabel: 'Desfazer',
      duration: 5500,
      async onAction() {
        if (!currentUser) return;
        if (!entries.some((x) => x.id === deletedItem.id)) {
          entries.push(deletedItem);
          renderAll();
        }
        try {
          await upsertEntryToCloud(currentUser.id, deletedItem, setSyncStatus);
          showToast('Lançamento restaurado!');
        } catch {
          entries = entries.filter((x) => x.id !== deletedItem.id);
          renderAll();
          showToast('Erro ao restaurar lançamento na nuvem');
        }
      }
    });
  } catch {
    entries = snapshot;
    renderAll();
    showToast('Erro ao excluir — registro restaurado');
  }
}

function handleEntryActionClick(e) {
  const confirmBtn = e.target.closest('.confirm-realized-btn');
  if (confirmBtn) {
    handleConfirmRealized(confirmBtn.dataset.confirmId, confirmBtn);
    return;
  }
  const icsBtn = e.target.closest('.ics-entry-btn');
  if (icsBtn) {
    const target = entries.find((item) => item.id === icsBtn.dataset.icsId);
    if (target) {
      const evs = buildCalendarEventsFromEntries([target], new Map(), settings);
      downloadIcsEvents(evs, `saldohoras-${target.date}.ics`);
      showToast('Evento .ICS baixado para sua agenda!');
    }
    return;
  }
  const editBtn = e.target.closest('.edit-entry-btn');
  if (editBtn) {
    const target = entries.find((item) => item.id === editBtn.dataset.editId);
    if (target) modals.openEntryModal(target, true);
    return;
  }
  const delBtn = e.target.closest('.delete-entry-btn');
  if (delBtn) {
    handleDeleteEntry(delBtn.dataset.deleteId);
  }
}

document.getElementById('entriesTableBody').addEventListener('click', handleEntryActionClick);
document.getElementById('mobileCardsContainer').addEventListener('click', handleEntryActionClick);

// ==================== FILTROS, ABAS & ATALHOS ====================
function applyQuickFilter(filterName) {
  quickFilter = filterName;
  document.querySelectorAll('.quick-pill').forEach((btn) => {
    btn.className = 'quick-pill px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition';
  });
  const activePill = document.getElementById(`pill-${filterName}`);
  if (activePill) {
    activePill.className = 'quick-pill px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-600 text-white transition';
  }
  renderAll();
}

function switchMainTab(tabName) {
  ['extrato', 'graficos', 'comunicacao'].forEach((t) => {
    document.getElementById(`tabPanel-${t}`).classList.toggle('hidden', t !== tabName);
    const btn = document.getElementById(`tabBtn-${t}`);
    if (btn) {
      btn.className = t === tabName
        ? 'main-tab-btn px-4 py-3 text-xs sm:text-sm font-semibold border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400 whitespace-nowrap flex items-center gap-2 transition'
        : 'main-tab-btn px-4 py-3 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap flex items-center gap-2 transition';
    }
    const mobBtn = document.getElementById(`mobileNavBtn-${t}`);
    if (mobBtn) {
      mobBtn.className = t === tabName
        ? 'mobile-nav-tab-btn flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 min-w-0'
        : 'mobile-nav-tab-btn flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 min-w-0';
    }
  });
  if (tabName === 'graficos') {
    renderAnalyticsTab();
  }
}

document.querySelectorAll('.balance-scope-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    analyticsBalanceScope = btn.dataset.balanceScope || 'all';
    document.querySelectorAll('.balance-scope-btn').forEach((b) => {
      const active = b.dataset.balanceScope === analyticsBalanceScope;
      b.className = active
        ? 'balance-scope-btn px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition'
        : 'balance-scope-btn px-2.5 py-1 rounded-md text-slate-500 dark:text-slate-400 transition';
    });
    renderAnalyticsTab();
  });
});

document.querySelectorAll('.ratio-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    analyticsRatioMode = btn.dataset.ratioMode || 'composition';
    document.querySelectorAll('.ratio-mode-btn').forEach((b) => {
      const active = b.dataset.ratioMode === analyticsRatioMode;
      b.className = active
        ? 'ratio-mode-btn px-2 py-1 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition'
        : 'ratio-mode-btn px-2 py-1 rounded-md text-slate-500 dark:text-slate-400 transition';
    });
    renderAnalyticsTab();
  });
});

document.getElementById('expiryBreakdownContainer')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.sim-from-bucket-btn');
  if (!btn) return;
  const remMins = Number(btn.dataset.simMinutes) || 0;
  const dailyMins = Math.max(60, Number(settings.dailyMinutes) || 480);
  const suggestedDays = Math.max(0.5, Math.ceil((remMins / dailyMins) * 2) / 2);
  const slider = document.getElementById('simDaysSlider');
  if (Number(slider.max) < suggestedDays) slider.max = String(Math.ceil(suggestedDays));
  slider.value = String(suggestedDays);
  updateSimulator();
  slider.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast(`Simulador ajustado para ${formatSimulatedDaysLabel(suggestedDays)} (${formatHHMM(remMins)} a vencer)`);
});

function resetAllFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('yearFilter').value = 'all';
  document.getElementById('typeFilter').value = 'all';
  document.getElementById('statusFilter').value = 'all';
  applyQuickFilter('all');
}

document.querySelectorAll('.quick-pill').forEach((btn) => {
  btn.addEventListener('click', () => applyQuickFilter(btn.dataset.quickFilter));
});
document.getElementById('viewExpiringBtn').addEventListener('click', () => applyQuickFilter('expiring'));
document.getElementById('clearFiltersBtn').addEventListener('click', resetAllFilters);
document.getElementById('emptyClearFiltersBtn')?.addEventListener('click', resetAllFilters);
document.getElementById('onboardingSettingsBtn')?.addEventListener('click', () => modals.openSettingsModal());
document.getElementById('onboardingHolidaysBtn')?.addEventListener('click', () => modals.openHolidaysModal());
document.getElementById('onboardingNewEntryBtn')?.addEventListener('click', () => modals.openEntryModal());

document.getElementById('searchInput').addEventListener('input', renderAll);
document.getElementById('yearFilter').addEventListener('change', renderAll);
document.getElementById('typeFilter').addEventListener('change', renderAll);
document.getElementById('statusFilter').addEventListener('change', renderAll);

document.getElementById('sortOrderBtn').addEventListener('click', () => {
  sortAscending = !sortAscending;
  document.getElementById('sortOrderLabel').textContent = sortAscending ? 'Mais antigos' : 'Mais recentes';
  renderAll();
});

document.querySelectorAll('.main-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchMainTab(btn.dataset.mainTab));
});

document.querySelectorAll('.mobile-nav-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchMainTab(btn.dataset.mobileNav);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// Botões de abertura de modais
document.getElementById('openNewEntryBtn').addEventListener('click', () => modals.openEntryModal());
document.getElementById('mobileNavNewEntryBtn')?.addEventListener('click', () => modals.openEntryModal());
document.getElementById('openSettingsBtn').addEventListener('click', () => modals.openSettingsModal());
document.getElementById('openHolidaysBtn').addEventListener('click', () => modals.openHolidaysModal());
document.getElementById('mobileNavHolidaysBtn')?.addEventListener('click', () => modals.openHolidaysModal());

// Simulador
document.getElementById('simDaysSlider').addEventListener('input', () => updateSimulator());
document.getElementById('scheduleFromSimBtn').addEventListener('click', () => {
  const simDays = Math.max(0.5, parseFloat(document.getElementById('simDaysSlider').value) || 1);
  const dailyMins = Number(settings.dailyMinutes) || 480;
  const simMins = Math.round(simDays * dailyMins);
  const targetDate = document.getElementById('simTargetDate')?.value || getLocalDateISO();
  modals.openEntryModal({
    type: 'debit',
    category: 'time_off',
    date: targetDate,
    minutes: simMins,
    title: `Folga Compensatória (${formatSimulatedDaysLabel(simDays)})`,
    status: targetDate <= getLocalDateISO() ? 'realized' : 'planned'
  }, false);
});

document.getElementById('downloadSimIcsBtn')?.addEventListener('click', () => {
  const simDays = Math.max(0.5, parseFloat(document.getElementById('simDaysSlider').value) || 1);
  const dailyMins = Number(settings.dailyMinutes) || 480;
  const simMins = Math.round(simDays * dailyMins);
  const targetDate = document.getElementById('simTargetDate')?.value || getLocalDateISO();
  const label = formatSimulatedDaysLabel(simDays);
  downloadIcsEvents([
    {
      uid: `sim-${targetDate}-${simMins}`,
      date: targetDate,
      summary: `Folga Compensatória (${label} • -${formatHHMM(simMins)})`,
      description: `Folga simulada pelo SaldoHoras usando ${formatHHMM(simMins)} do banco de horas.`,
      alarmDaysBefore: 1
    }
  ], `saldohoras-folga-${targetDate}.ics`);
  showToast('Lembrete .ICS da folga baixado!');
});

// Comunicação RH / WhatsApp
document.querySelectorAll('[data-action="regen-messages"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const { chrono } = computeChronologicalAndFIFO(entries);
    const { emailText, whatsappText } = buildCommunicationTemplates(chrono, settings);
    document.getElementById('emailTemplate').value = emailText;
    document.getElementById('whatsappTemplate').value = whatsappText;
    showToast('Textos atualizados com o saldo atual');
  });
});

document.querySelectorAll('[data-copy-target]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const copied = await copyElementText(btn.dataset.copyTarget);
    showToast(copied ? (btn.dataset.copyToast || 'Copiado!') : 'Não foi possível copiar automaticamente');
  });
});

document.getElementById('openMailClientBtn').addEventListener('click', () => {
  const body = document.getElementById('emailTemplate').value;
  const to = settings.managerEmail || '';
  const subject = encodeURIComponent(`Alinhamento Banco de Horas — ${settings.userName || getLocalDateISO().slice(0, 4)}`);
  window.open(`mailto:${to}?subject=${subject}&body=${encodeURIComponent(body)}`, '_blank');
});

document.getElementById('openWhatsAppBtn').addEventListener('click', () => {
  const text = encodeURIComponent(document.getElementById('whatsappTemplate').value);
  const phone = settings.managerPhone || '';
  window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
});

// Exportações & Backup JSON
function closeExportMenu() {
  document.getElementById('exportDropdown').classList.add('hidden');
}

document.getElementById('exportMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('exportDropdown');
  dd.classList.toggle('hidden');
  if (!dd.classList.contains('hidden')) updateQuickExportCountHint();
});
document.addEventListener('click', (e) => {
  if (!document.getElementById('exportMenuWrapper').contains(e.target)) closeExportMenu();
});

function getExportDataset() {
  const { chrono, remainingMap, filtered, hasActiveFilters } = getFilteredEntriesState();
  const filteredOnly = Boolean(document.getElementById('exportFilteredOnly')?.checked) && hasActiveFilters;
  const rows = filteredOnly ? filtered : chrono;
  const scopeLabel = filteredOnly
    ? `Escopo: Filtro aplicado (${rows.length} de ${chrono.length} registros)`
    : `Escopo: Extrato completo (${chrono.length} registros)`;
  return { chrono, remainingMap, rows, scopeLabel, filteredOnly };
}

function updateQuickExportCountHint() {
  const hint = document.getElementById('exportQuickCountHint');
  if (!hint) return;
  const { chrono, rows, filteredOnly } = getExportDataset();
  hint.textContent = filteredOnly
    ? `${rows.length} de ${chrono.length} registros (filtrados)`
    : `${chrono.length} ${chrono.length === 1 ? 'registro' : 'registros'} no recorte`;
}

document.getElementById('exportFilteredOnly')?.addEventListener('change', updateQuickExportCountHint);

document.getElementById('exportPdfBtn').addEventListener('click', async () => {
  const { chrono, remainingMap, rows, scopeLabel } = getExportDataset();
  const integrityCode = await computeIntegrityDigest(rows, settings, scopeLabel);
  const opts = { userEmail: currentUser?.email, scopeLabel, globalChrono: chrono, remainingMap, integrityCode };
  try {
    exportPDF(rows, settings, opts);
    showToast('Relatório PDF oficial baixado!');
  } catch (err) {
    if (err?.code === 'JSPDF_UNAVAILABLE') {
      exportModal.triggerNativePrint(rows, opts);
    } else {
      showToast(err.message || 'Erro ao gerar PDF');
    }
  } finally {
    closeExportMenu();
  }
});

document.getElementById('exportXmlBtn')?.addEventListener('click', async () => {
  try {
    const { chrono, remainingMap, rows, scopeLabel } = getExportDataset();
    const integrityCode = await computeIntegrityDigest(rows, settings, scopeLabel);
    exportStructuredXML(rows, remainingMap, settings, {
      userEmail: currentUser?.email,
      scopeLabel,
      globalChrono: chrono,
      integrityCode
    });
    showToast('Arquivo XML (.xml) exportado!');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar XML');
  } finally {
    closeExportMenu();
  }
});

document.getElementById('exportExcelXmlBtn')?.addEventListener('click', async () => {
  try {
    const { chrono, remainingMap, rows, scopeLabel } = getExportDataset();
    exportExcelXML(rows, remainingMap, settings, {
      userEmail: currentUser?.email,
      scopeLabel,
      globalChrono: chrono
    });
    showToast('Planilha Excel (.xls) exportada!');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar planilha Excel');
  } finally {
    closeExportMenu();
  }
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  try {
    const { rows } = getExportDataset();
    exportCSV(rows, { includeSummary: true });
    showToast('Planilha CSV exportada!');
  } catch (err) {
    showToast(err.message || 'Erro ao exportar CSV');
  } finally {
    closeExportMenu();
  }
});

document.getElementById('exportIcsBtn')?.addEventListener('click', () => {
  try {
    const { remainingMap, rows } = getExportDataset();
    const events = buildCalendarEventsFromEntries(rows, remainingMap, settings);
    downloadIcsEvents(events);
    showToast(`${events.length} lembretes exportados para agenda (.ics)!`);
  } catch (err) {
    showToast(err.message || 'Nenhum evento futuro ou vencimento pendente para exportar.');
  } finally {
    closeExportMenu();
  }
});

document.getElementById('exportJsonBtn').addEventListener('click', async () => {
  const { chrono } = computeChronologicalAndFIFO(entries);
  const code = await computeIntegrityDigest(chrono, settings, 'Backup JSON Completo');
  exportJSONBackup(settings, entries, code);
  showToast('Backup JSON baixado!');
});
document.getElementById('exportJsonMenuBtn').addEventListener('click', async () => {
  const { chrono } = computeChronologicalAndFIFO(entries);
  const code = await computeIntegrityDigest(chrono, settings, 'Backup JSON Completo');
  exportJSONBackup(settings, entries, code);
  closeExportMenu();
  showToast('Backup JSON baixado!');
});

document.getElementById('openExportModalBtn')?.addEventListener('click', () => {
  closeExportMenu();
  exportModal.openExportModal();
});

document.getElementById('commDownloadRealizedPdfBtn')?.addEventListener('click', async () => {
  const { chrono, remainingMap } = computeChronologicalAndFIFO(entries);
  const realizedRows = chrono.filter((e) => e.status === 'realized');
  const scopeLabel = `Somente Realizados p/ RH (${realizedRows.length} de ${chrono.length} registros)`;
  const integrityCode = await computeIntegrityDigest(realizedRows, settings, scopeLabel);
  const opts = { userEmail: currentUser?.email, scopeLabel, globalChrono: chrono, remainingMap, integrityCode };
  try {
    exportPDF(realizedRows, settings, opts);
    showToast('PDF de realizados baixado para o RH!');
  } catch (err) {
    if (err?.code === 'JSPDF_UNAVAILABLE') exportModal.triggerNativePrint(realizedRows, opts);
    else showToast(err.message || 'Sem registros realizados para gerar PDF');
  }
});

document.getElementById('commDownloadIcsBtn')?.addEventListener('click', () => {
  try {
    const { chrono, remainingMap } = computeChronologicalAndFIFO(entries);
    const events = buildCalendarEventsFromEntries(chrono, remainingMap, settings);
    downloadIcsEvents(events);
    showToast(`${events.length} lembretes exportados para agenda (.ics)!`);
  } catch (err) {
    showToast(err.message || 'Nenhuma folga prevista ou prazo em aberto para agenda.');
  }
});

function handleJsonImportChange(event) {
  const file = event.target.files?.[0];
  if (!file || !currentUser) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const { validEntries, skippedCount } = validateAndNormalizeImportedEntries(parsed.entries);

      if (validEntries.length === 0) {
        showToast('Nenhum lançamento válido encontrado no JSON');
        return;
      }

      const skipNote = skippedCount > 0 ? ` (${skippedCount} registro(s) inválido(s) ignorado(s))` : '';
      const ok = await modals.confirmDialog({
        title: 'Importar backup JSON?',
        message: `Serão mesclados ${validEntries.length} lançamentos na sua conta sem apagar registros existentes${skipNote}.`,
        confirmText: 'Importar agora',
        cancelText: 'Cancelar',
        variant: 'primary'
      });
      if (!ok) return;

      const prevSettings = { ...settings };
      const prevEntries = [...entries];

      if (parsed.settings && typeof parsed.settings === 'object') {
        const nextDaily = parsed.settings.dailyMinutes
          || Math.round((Number(parsed.settings.dailyHours) || 8) * 60);
        settings = {
          ...settings,
          userName: typeof parsed.settings.userName === 'string' ? parsed.settings.userName : settings.userName,
          dailyMinutes: nextDaily > 0 ? nextDaily : settings.dailyMinutes,
          expiryDays: Number(parsed.settings.expiryDays) || settings.expiryDays,
          managerEmail: typeof parsed.settings.managerEmail === 'string' ? parsed.settings.managerEmail : settings.managerEmail,
          managerPhone: typeof parsed.settings.managerPhone === 'string' ? parsed.settings.managerPhone : settings.managerPhone,
          unionMode: parsed.settings.unionMode || settings.unionMode,
          unionCode: parsed.settings.unionCode || settings.unionCode,
          companySector: parsed.settings.companySector || settings.companySector,
          overtimeMultiplier: Number(parsed.settings.overtimeMultiplier) || settings.overtimeMultiplier,
          holidayMultiplier: Number(parsed.settings.holidayMultiplier) || settings.holidayMultiplier,
          stateUf: parsed.settings.stateUf || settings.stateUf
        };
      }

      validEntries.forEach((clean) => {
        const idx = entries.findIndex((x) => x.id === clean.id);
        if (idx >= 0) entries[idx] = clean;
        else entries.push(clean);
      });

      try {
        if (parsed.settings) {
          await saveSettingsToCloud(currentUser.id, settings, setSyncStatus);
        }
        await upsertEntriesBatchToCloud(currentUser.id, validEntries, setSyncStatus);
        updateHeaderUserInfo();
        modals.closeSettingsModal();
        exportModal.closeExportModal();
        renderAll();
        showToast(`Backup importado (${validEntries.length} registros)!`);
      } catch {
        settings = prevSettings;
        entries = prevEntries;
        updateHeaderUserInfo();
        renderAll();
        showToast('Erro ao importar na nuvem — alteração revertida');
      }
    } catch {
      showToast('Arquivo JSON inválido ou corrompido');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

const exportModal = createExportModalManager({
  getExportContext: getFilteredEntriesState,
  getSettings: () => settings,
  getEntries: () => entries,
  getUserEmail: () => currentUser?.email || '',
  onImportJsonEvent: handleJsonImportChange,
  showToast,
  registerExternalModal: modals.registerExternalModal,
  captureLastFocus: modals.captureLastFocus,
  restoreLastFocus: modals.restoreLastFocus
});

document.getElementById('importJsonInput').addEventListener('change', handleJsonImportChange);

// Atalhos de teclado globais
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modals.handleEscapeKey()) return;
    closeExportMenu();
    return;
  }

  if (!currentUser) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (modals.hasOpenModal()) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;

  const key = e.key.toLowerCase();
  if (key === 'n') {
    e.preventDefault();
    modals.openEntryModal();
  } else if (key === 'e') {
    e.preventDefault();
    exportModal.openExportModal();
  } else if (key === 'f') {
    e.preventDefault();
    modals.openHolidaysModal();
  } else if (key === 'p') {
    e.preventDefault();
    profile.openProfileModal('perfil');
  } else if (key === 's') {
    e.preventDefault();
    modals.openSettingsModal();
  } else if (e.key === '?' || (e.shiftKey && e.key === '?')) {
    e.preventDefault();
    modals.openShortcutsModal();
  } else if (e.key === '/') {
    e.preventDefault();
    switchMainTab('extrato');
    document.getElementById('searchInput').focus();
  }
});

// ==================== AUTENTICAÇÃO, PERFIL & INICIALIZAÇÃO ====================
let authController = null;

const profile = createProfileManager({
  getUser: () => currentUser,
  setUser(user) {
    currentUser = user;
    updateHeaderUserInfo();
  },
  getSettings: () => settings,
  getEntries: () => entries,
  saveSettings: persistSettings,
  openSettingsModal: () => modals.openSettingsModal(),
  confirmDialog: (opts) => modals.confirmDialog(opts),
  showToast,
  onLogout: (scope) => authController?.performLogout(scope),
  registerExternalModal: modals.registerExternalModal,
  captureLastFocus: modals.captureLastFocus,
  restoreLastFocus: modals.restoreLastFocus
});

document.getElementById('openProfileBtn')?.addEventListener('click', () => profile.openProfileModal('perfil'));
document.getElementById('openProfileFromSettingsBtn')?.addEventListener('click', () => {
  modals.closeSettingsModal();
  profile.openProfileModal('seguranca');
});
document.getElementById('profileMobileSettingsBtn')?.addEventListener('click', () => {
  profile.closeProfileModal();
  modals.openSettingsModal();
});
document.getElementById('profileMobileThemeBtn')?.addEventListener('click', toggleTheme);

authController = setupAuth({
  onToast: showToast,
  onUserUpdated(user) {
    currentUser = user;
    updateHeaderUserInfo();
    profile.syncProfileHeaderSummary();
  },
  onSignedOut() {
    currentUser = null;
    entries = [];
    destroyCharts();
    const avatarEl = document.getElementById('headerProfileAvatar');
    const labelEl = document.getElementById('headerProfileLabel');
    if (avatarEl) avatarEl.textContent = 'SH';
    if (labelEl) labelEl.textContent = 'Perfil';
  },
  async onSessionReady(user) {
    currentUser = user;
    setSyncStatus('saving');
    try {
      const data = await loadUserDataFromCloud(user);
      settings = data.settings;
      entries = data.entries;
      try {
        if (settings.stateUf) localStorage.setItem(STORAGE_KEYS.HOLIDAY_UF, settings.stateUf);
      } catch { /* ignore */ }
      updateHeaderUserInfo();
      setSyncStatus('ok');
      renderAll();
    } catch (err) {
      console.error('Erro ao carregar dados do Supabase:', err);
      setSyncStatus('error');
      showToast('Erro ao sincronizar com o Supabase');
    } finally {
      document.getElementById('loadingOverlay').classList.add('hidden');
    }
  }
});

// ==================== INSTALAÇÃO PWA & STATUS DE REDE ====================
let deferredInstallPrompt = null;
const pwaBanner = document.getElementById('pwaInstallBanner');
const pwaInstallBtn = document.getElementById('pwaInstallBtn');
const pwaDismissBtn = document.getElementById('pwaDismissBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem('sh_pwa_dismissed') && pwaBanner) {
    pwaBanner.classList.remove('hidden');
    window.lucide?.createIcons();
  }
});

pwaInstallBtn?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    showToast('SaldoHoras instalado com sucesso!');
  }
  deferredInstallPrompt = null;
  pwaBanner?.classList.add('hidden');
});

pwaDismissBtn?.addEventListener('click', () => {
  pwaBanner?.classList.add('hidden');
  try {
    localStorage.setItem('sh_pwa_dismissed', '1');
  } catch { /* ignore */ }
});

window.addEventListener('online', () => {
  setSyncStatus('ok');
  showToast('Conexão restabelecida — nuvem sincronizada');
});

window.addEventListener('offline', () => {
  setSyncStatus('offline');
  showToast('Você está offline — dados salvos localmente');
});

if (typeof navigator !== 'undefined' && navigator.onLine === false) {
  setSyncStatus('offline');
}

// Registro de Service Worker PWA com caminho relativo para GitHub Pages
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Falha silenciosa caso navegador restrinja SW em ambiente de teste
    });
  });
}

initTheme();
window.lucide?.createIcons();
