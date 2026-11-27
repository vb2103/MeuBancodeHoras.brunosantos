import { setupAuth } from './auth.js';
import { destroyCharts, renderCharts } from './charts.js';
import { APP_PUBLIC_URL, APP_VERSION, ENTRY_CATEGORIES, STORAGE_KEYS, escapeHtml, formatDateBR, getLocalDateISO } from './config.js';
import { computeCycleCarryOver, loadArchivedCycles, mergeArchivedCycles, saveArchivedCycles } from './cycles.js';
import {
  clearGuestState,
  computeGuestMigrationPlan,
  createDemoEntries,
  isGuestBannerDismissed,
  isGuestModeActive,
  loadGuestState,
  mergeGuestWithCloudEntries,
  saveGuestState,
  setGuestBannerDismissed,
  setGuestModeActive
} from './guest.js';
import {
  clearClientUserStorage,
  clearPendingRulePreset,
  formatPendingLogoutWarning,
  initServiceWorkerUpdates,
  loadPendingRulePreset,
  parseAndCleanAppLaunchUrl,
  savePendingRulePreset
} from './pwa.js';
import {
  createDefaultSettings,
  deleteAllEntriesFromCloud,
  deleteEntryFromCloud,
  loadUserDataFromCloud,
  saveArchivedCyclesToCloud,
  saveSettingsToCloud,
  submitFeedbackToCloud,
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
import { findUnionByCode, getActiveRuleSummary } from './rules-catalog.js';
import { getUserInitials } from './security.js';
import {
  applyQueueToState,
  enqueueSyncOp,
  hasCompletedOnboarding,
  isLikelyNetworkError,
  loadSyncQueue,
  loadUserCache,
  markOnboardingCompleted,
  saveSyncQueue,
  saveUserCache
} from './sync-queue.js';
import {
  buildExpiryAlertSummary,
  computeChronologicalAndFIFO,
  formatDaysFromMinutes,
  formatHHMM,
  formatUrgentExpiryCardNote,
  getExpiryBadge,
  isHolidayEntry,
  isInitialBalanceEntry,
  isWriteOffEntry,
  maskPrivacyDays,
  maskPrivacyHours
} from './time.js';
import {
  clearAllInlineErrors,
  closeAnimatedDropdown,
  closeAnimatedModal,
  initAccordions,
  initSlidingTabsGroup,
  isLayerOpen,
  openAnimatedDropdown,
  openAnimatedModal,
  prefersReducedMotion,
  readCssMs,
  renderLucideIcons,
  setSubtleNumberValue,
  syncSlidingTabs,
  triggerInlineFieldError
} from './ui-motion.js';
import { ensureChartJs, ensureJsPdf } from './vendor-loader.js';

// ==================== ESTADO DA APLICAÇÃO ====================
const ENTRIES_PAGE_SIZE = 50;
let currentUser = null;
let isGuestMode = false;
let sortAscending = true;
let quickFilter = 'all';
let entriesVisibleLimit = ENTRIES_PAGE_SIZE;
let searchDebounceTimer = null;
let lastRenderedRealizedMinutes = null;
let activeMainTab = 'extrato'; // 'extrato' | 'graficos' | 'comunicacao'
let activeAnalyticsSubTab = 'simulador'; // 'simulador' | 'graficos'
let analyticsBalanceScope = 'all'; // 'all' | 'realized'
let analyticsRatioMode = 'composition'; // 'composition' | 'origin'
let settings = createDefaultSettings();
let entries = [];
let archivedCycles = [];
let activeDetailCycle = null;
let toastTimer = null;
let renderedChronoById = new Map();
let renderedRemainingMap = new Map();
let activeDetailEntryId = null;
let syncAlertDismissedState = null;
let lastSyncState = 'ok';
let isFlushingQueue = false;
let defaultTemplatesCache = { emailTemplate: '', whatsappTemplate: '' };
const initialAppLaunch = (() => {
  if (typeof window === 'undefined') {
    return { shortcut: null, mode: null, preset: null, category: null, hours: null, minutes: null };
  }
  const parsed = parseAndCleanAppLaunchUrl(window.location.href);
  if (parsed.preset) {
    savePendingRulePreset(parsed);
  }
  if (parsed.hadParam) {
    window.history.replaceState({}, document.title, parsed.cleanUrl);
  }
  return parsed;
})();
let pendingUrlShortcut = initialAppLaunch.shortcut;
const pendingAuthMode = initialAppLaunch.mode;
let pendingSimulatorEntry = (() => {
  if (initialAppLaunch.hours === null && initialAppLaunch.minutes === null) {
    const saved = loadPendingRulePreset();
    if (!saved || (saved.hours === null && saved.minutes === null)) return null;
    const total = (Number(saved.hours) || 0) * 60 + (Number(saved.minutes) || 0);
    return total > 0 ? { category: saved.category || 'holiday', minutes: total } : null;
  }
  const total = (Number(initialAppLaunch.hours) || 0) * 60 + (Number(initialAppLaunch.minutes) || 0);
  return total > 0 ? { category: initialAppLaunch.category || 'holiday', minutes: total } : null;
})();
let privacyMode = (() => {
  try {
    return localStorage.getItem(STORAGE_KEYS.PRIVACY) === '1';
  } catch {
    return false;
  }
})();

function formatVisibleHHMM(mins, showPlus = false) {
  const formatted = formatHHMM(mins, showPlus);
  return privacyMode ? maskPrivacyHours(formatted) : formatted;
}

function formatVisibleDays(mins, dailyMins, withSuffix = false) {
  const base = formatDaysFromMinutes(mins, dailyMins);
  if (privacyMode) return maskPrivacyDays(base, withSuffix && mins >= 0);
  return withSuffix && mins >= 0 ? `${base} de folga` : base;
}

function syncPrivacyButtonsUI() {
  const iconState = privacyMode ? 'b' : 'a';
  const labelText = privacyMode ? 'Exibir valores ocultos' : 'Ocultar valores';
  const swapIds = {
    mobilePrivacyToggleBtn: 'mobilePrivacyIconSwap',
    desktopPrivacyToggleBtn: 'desktopPrivacyIconSwap'
  };
  ['mobilePrivacyToggleBtn', 'desktopPrivacyToggleBtn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(privacyMode));
    btn.setAttribute('aria-label', labelText);
    btn.title = privacyMode ? 'Modo privacidade ativo (clique para exibir)' : 'Modo privacidade (ocultar horas)';
    const swapEl = document.getElementById(swapIds[id]);
    if (swapEl) swapEl.setAttribute('data-state', iconState);
  });
}

function togglePrivacyMode() {
  privacyMode = !privacyMode;
  try {
    localStorage.setItem(STORAGE_KEYS.PRIVACY, privacyMode ? '1' : '0');
  } catch { /* ignore */ }
  syncPrivacyButtonsUI();
  renderAll();
}

function hasActiveWorkspace() {
  return Boolean(currentUser || isGuestMode);
}

// ==================== TOAST, SYNC & FILA OFFLINE ====================
function persistCurrentUserSnapshot() {
  if (isGuestMode && !currentUser) {
    saveGuestState({ settings, entries });
    return;
  }
  if (!currentUser?.id) return;
  saveUserCache(currentUser.id, { settings, entries });
}

function enqueueLocalSync(op) {
  if (!currentUser?.id) return 0;
  const current = loadSyncQueue(currentUser.id);
  const next = enqueueSyncOp(current, op);
  saveSyncQueue(currentUser.id, next);
  persistCurrentUserSnapshot();
  return next.length;
}

function clearSyncedQueueOps(predicate) {
  if (!currentUser?.id) return;
  const current = loadSyncQueue(currentUser.id);
  if (!current.length) return;
  const next = current.filter((op) => !predicate(op));
  if (next.length !== current.length) {
    saveSyncQueue(currentUser.id, next);
  }
}

async function flushPendingSyncQueue({ showSyncedToast = false } = {}) {
  if (!currentUser?.id || isFlushingQueue) return 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

  let queue = loadSyncQueue(currentUser.id);
  if (!queue.length) {
    if (lastSyncState === 'offline' || lastSyncState === 'pending') {
      setSyncStatus('ok');
    }
    return 0;
  }

  isFlushingQueue = true;
  setSyncStatus('saving');
  let syncedCount = 0;

  try {
    while (queue.length > 0) {
      const op = queue[0];
      if (op.kind === 'settings' && op.settings) {
        await saveSettingsToCloud(currentUser.id, op.settings);
      } else if (op.kind === 'cycles' && Array.isArray(op.cycles)) {
        await saveArchivedCyclesToCloud(currentUser.id, op.cycles);
      } else if (op.kind === 'upsert' && op.entry) {
        await upsertEntryToCloud(currentUser.id, op.entry);
      } else if (op.kind === 'delete' && op.id) {
        await deleteEntryFromCloud(currentUser.id, op.id);
      }
      queue = queue.slice(1);
      saveSyncQueue(currentUser.id, queue);
      syncedCount += 1;
    }

    persistCurrentUserSnapshot();
    setSyncStatus('ok');
    if (syncedCount > 0 && showSyncedToast) {
      showToast('Dados sincronizados na nuvem', { duration: 3000 });
    }
    return syncedCount;
  } catch (err) {
    setSyncStatus(isLikelyNetworkError(err) ? 'offline' : 'pending');
    return syncedCount;
  } finally {
    isFlushingQueue = false;
  }
}

function hideToast() {
  const toast = document.getElementById('toast');
  const actionBtn = document.getElementById('toastActionBtn');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.classList.remove('is-open');
  toast.setAttribute('aria-hidden', 'true');
  if (actionBtn) actionBtn.onclick = null;
}

function showToast(msg, options = {}) {
  const { actionLabel = null, onAction = null, duration = 3000 } = options || {};
  const toast = document.getElementById('toast');
  const actionBtn = document.getElementById('toastActionBtn');
  if (!toast) return;
  if (toast._hideBtnTimer) {
    clearTimeout(toast._hideBtnTimer);
    toast._hideBtnTimer = null;
  }
  document.getElementById('toastMsg').textContent = msg;

  if (actionBtn) {
    if (actionLabel && typeof onAction === 'function') {
      actionBtn.textContent = actionLabel;
      actionBtn.classList.remove('hidden');
      actionBtn.onclick = async () => {
        actionBtn.disabled = true;
        hideToast();
        actionBtn.classList.add('hidden');
        actionBtn.disabled = false;
        await onAction();
      };
    } else {
      actionBtn.classList.add('hidden');
      actionBtn.onclick = null;
    }
  }

  toast.setAttribute('aria-hidden', 'false');
  toast.classList.remove('is-open');
  void toast.offsetWidth;
  toast.classList.add('is-open');
  clearTimeout(toastTimer);
  if (typeof duration === 'number' && duration > 0) {
    toastTimer = setTimeout(() => {
      hideToast();
      if (actionBtn) {
        const closeMs = readCssMs('--toast-close', 250) + 16;
        toast._hideBtnTimer = setTimeout(() => {
          toast._hideBtnTimer = null;
          if (!toast.classList.contains('is-open')) {
            actionBtn.classList.add('hidden');
          }
        }, closeMs);
      }
    }, duration);
  }
}

const SYNC_STATUS_STYLES = {
  saving: {
    text: 'Sincronizando...',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70'
  },
  pending: {
    text: 'Aguardando envio',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50/90 text-amber-800 border-amber-200/80 dark:bg-amber-950/35 dark:text-amber-200 dark:border-amber-800/60'
  },
  offline: {
    text: 'Offline — dados salvos no aparelho',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50/90 text-amber-800 border-amber-200/80 dark:bg-amber-950/35 dark:text-amber-200 dark:border-amber-800/60'
  },
  local: {
    text: 'Armazenado localmente',
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70'
  },
  error: {
    text: 'Sem conexão com a nuvem',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70'
  },
  ok: {
    text: 'Sincronizado agora',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70'
  }
};

function setSyncStatus(state) {
  const pendingCount = currentUser?.id ? loadSyncQueue(currentUser.id).length : 0;
  const resolvedState = (state === 'ok' && pendingCount > 0) ? 'pending' : state;
  lastSyncState = resolvedState;
  if (resolvedState === 'ok') {
    syncAlertDismissedState = null;
  }

  const badge = document.getElementById('syncBadge');
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  const cfg = SYNC_STATUS_STYLES[resolvedState] || SYNC_STATUS_STYLES.ok;
  const pendingSuffix = pendingCount > 0
    ? ` • ${pendingCount} ${pendingCount === 1 ? 'pendente' : 'pendentes'}`
    : '';
  const statusLabel = resolvedState === 'pending'
    ? `${pendingCount} ${pendingCount === 1 ? 'alteração pendente' : 'alterações pendentes'}`
    : `${cfg.text}${resolvedState === 'offline' ? pendingSuffix : ''}`;

  if (badge && text) {
    text.textContent = statusLabel;
    badge.title = statusLabel;
    badge.setAttribute('aria-label', `Sincronização: ${statusLabel}`);
    badge.className = `sh-sync-badge sh-mobile-hide inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.badge}`;
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${cfg.dot}`;
  }

  const menuBadge = document.getElementById('userMenuSyncBadge');
  const menuDot = document.getElementById('userMenuSyncDot');
  const menuText = document.getElementById('userMenuSyncText');
  if (menuText) menuText.textContent = statusLabel;
  if (menuBadge) {
    menuBadge.className = `mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.badge}`;
  }
  if (menuDot) menuDot.className = `w-1.5 h-1.5 rounded-full ${cfg.dot}`;

  const mobileAlert = document.getElementById('mobileSyncAlertBanner');
  const mobileAlertDot = document.getElementById('mobileSyncAlertDot');
  const mobileAlertText = document.getElementById('mobileSyncAlertText');
  if (mobileAlert && mobileAlertText) {
    const isAlertState = resolvedState === 'error' || resolvedState === 'offline' || resolvedState === 'pending';
    const shouldShow = isAlertState && syncAlertDismissedState !== resolvedState;
    mobileAlert.className = `sh-mobile-only px-3 py-1.5 rounded-xl border text-xs font-medium ${cfg.badge}${shouldShow ? '' : ' hidden'}`;
    mobileAlert.style.display = shouldShow ? '' : 'none';
    if (mobileAlertDot) mobileAlertDot.className = `w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`;
    mobileAlertText.textContent = shouldShow
      ? (resolvedState === 'error'
        ? 'Sem sincronização com a nuvem — tente novamente em instantes.'
        : resolvedState === 'pending'
          ? `${pendingCount} ${pendingCount === 1 ? 'alteração aguardando envio' : 'alterações aguardando envio'}.`
          : `Modo offline${pendingSuffix} — dados salvos localmente.`)
      : '';
  }
}

document.getElementById('dismissMobileSyncAlertBtn')?.addEventListener('click', () => {
  syncAlertDismissedState = lastSyncState;
  const mobileAlert = document.getElementById('mobileSyncAlertBanner');
  if (mobileAlert) {
    mobileAlert.classList.add('hidden');
    mobileAlert.style.display = 'none';
  }
});

// ==================== TEMA CLARO / ESCURO ====================
function syncThemeUiLabels() {
  const isDark = document.documentElement.classList.contains('dark');
  const menuBadge = document.getElementById('userMenuThemeBadge');
  if (menuBadge) menuBadge.textContent = isDark ? 'Escuro' : 'Claro';
  const swapState = isDark ? 'b' : 'a';
  ['authThemeIconSwap', 'menuThemeIconSwap'].forEach((id) => {
    document.getElementById(id)?.setAttribute('data-state', swapState);
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', savedTheme === 'dark' || (!savedTheme && prefersDark));
  syncThemeUiLabels();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
  syncThemeUiLabels();
  if (!document.getElementById('tabPanel-graficos').classList.contains('hidden')) {
    renderAnalyticsTab();
  }
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);
document.getElementById('authThemeToggle').addEventListener('click', toggleTheme);

async function persistSettings(nextSettings, { silentToast = false } = {}) {
  if (!hasActiveWorkspace()) return false;
  const prevSettings = { ...settings };
  settings = nextSettings;
  persistCurrentUserSnapshot();

  if (isGuestMode && !currentUser) {
    updateHeaderUserInfo();
    setSyncStatus('local');
    renderAll();
    if (!silentToast) showToast('Configuração salva neste aparelho!');
    return true;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueueLocalSync({ kind: 'settings', settings: nextSettings });
    updateHeaderUserInfo();
    setSyncStatus('offline');
    renderAll();
    if (!silentToast) showToast('Parâmetros salvos no aparelho (aguardando conexão)');
    return true;
  }

  try {
    await saveSettingsToCloud(currentUser.id, settings, setSyncStatus);
    clearSyncedQueueOps((op) => op.kind === 'settings');
    updateHeaderUserInfo();
    renderAll();
    if (!silentToast) showToast('Parâmetros salvos na nuvem!');
    void flushPendingSyncQueue({ showSyncedToast: false });
    return true;
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueLocalSync({ kind: 'settings', settings: nextSettings });
      updateHeaderUserInfo();
      setSyncStatus('offline');
      renderAll();
      if (!silentToast) showToast('Sem conexão — parâmetros salvos na fila local');
      return true;
    }
    settings = prevSettings;
    persistCurrentUserSnapshot();
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
  onOnboardingCompleted() {
    if (currentUser?.id) markOnboardingCompleted(currentUser.id);
    if (pendingSimulatorEntry && !modals.hasOpenModal()) {
      window.setTimeout(() => {
        if (!modals.hasOpenModal()) consumePendingSimulatorEntry();
      }, 220);
    }
  },
  async saveEntry(entryObj) {
    if (!hasActiveWorkspace()) return false;
    const snapshot = [...entries];
    const idx = entries.findIndex((item) => item.id === entryObj.id);
    if (idx >= 0) entries[idx] = entryObj;
    else entries.push(entryObj);
    persistCurrentUserSnapshot();

    if (isGuestMode && !currentUser) {
      setSyncStatus('local');
      renderAll();
      showToast('Lançamento salvo neste aparelho!');
      return true;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enqueueLocalSync({ kind: 'upsert', entry: entryObj });
      setSyncStatus('offline');
      renderAll();
      showToast('Salvo no aparelho — será enviado ao reconectar');
      return true;
    }

    try {
      await upsertEntryToCloud(currentUser.id, entryObj, setSyncStatus);
      clearSyncedQueueOps((op) => op.kind !== 'settings' && (op.id === entryObj.id || op.entry?.id === entryObj.id));
      renderAll();
      showToast('Lançamento salvo na nuvem!');
      void flushPendingSyncQueue({ showSyncedToast: false });
      return true;
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        enqueueLocalSync({ kind: 'upsert', entry: entryObj });
        setSyncStatus('offline');
        renderAll();
        showToast('Sem conexão — alteração salva na fila local');
        return true;
      }
      entries = snapshot;
      persistCurrentUserSnapshot();
      renderAll();
      showToast('Falha ao salvar na nuvem — alteração revertida');
      return false;
    }
  },
  async addEntriesBatch(newEntries) {
    if (!hasActiveWorkspace() || !newEntries.length) return false;
    const snapshot = [...entries];
    entries = [...entries, ...newEntries];
    persistCurrentUserSnapshot();

    if (isGuestMode && !currentUser) {
      setSyncStatus('local');
      renderAll();
      return true;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      newEntries.forEach((entry) => enqueueLocalSync({ kind: 'upsert', entry }));
      setSyncStatus('offline');
      renderAll();
      return true;
    }

    try {
      await upsertEntriesBatchToCloud(currentUser.id, newEntries, setSyncStatus);
      const savedIds = new Set(newEntries.map((entry) => entry.id));
      clearSyncedQueueOps((op) => op.kind !== 'settings' && savedIds.has(op.id || op.entry?.id));
      renderAll();
      void flushPendingSyncQueue({ showSyncedToast: false });
      return true;
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        newEntries.forEach((entry) => enqueueLocalSync({ kind: 'upsert', entry }));
        setSyncStatus('offline');
        renderAll();
        return true;
      }
      entries = snapshot;
      persistCurrentUserSnapshot();
      renderAll();
      showToast('Erro ao importar para a nuvem — revertido');
      return false;
    }
  },
  async removeEntryQuiet(id) {
    if (!hasActiveWorkspace() || !id) return false;
    const snapshot = [...entries];
    entries = entries.filter((e) => e.id !== id);
    persistCurrentUserSnapshot();

    if (isGuestMode && !currentUser) {
      setSyncStatus('local');
      renderAll();
      return true;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enqueueLocalSync({ kind: 'delete', id });
      setSyncStatus('offline');
      renderAll();
      return true;
    }

    try {
      await deleteEntryFromCloud(currentUser.id, id, setSyncStatus);
      clearSyncedQueueOps((op) => op.kind !== 'settings' && (op.id === id || op.entry?.id === id));
      renderAll();
      void flushPendingSyncQueue({ showSyncedToast: false });
      return true;
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        enqueueLocalSync({ kind: 'delete', id });
        setSyncStatus('offline');
        renderAll();
        return true;
      }
      entries = snapshot;
      persistCurrentUserSnapshot();
      renderAll();
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
  const mobileRuleEl = document.getElementById('mobileRuleSummary');
  if (mobileRuleEl) {
    mobileRuleEl.textContent = `${ruleLabel} (${settings.stateUf || 'SP'}) • Jornada ${formatHHMM(settings.dailyMinutes)}/dia`;
  }

  const mgrEmailEl = document.getElementById('settingManagerEmail');
  const mgrPhoneEl = document.getElementById('settingManagerPhone');
  const mgrSummaryEl = document.getElementById('commManagerSummaryText');
  const mgrBtnEl = document.getElementById('toggleCommManagerBtn');
  if (mgrEmailEl) mgrEmailEl.value = settings.managerEmail || '';
  if (mgrPhoneEl) mgrPhoneEl.value = settings.managerPhone || '';
  const mgrParts = [
    settings.managerEmail ? settings.managerEmail : '',
    settings.managerPhone ? `WhatsApp ${settings.managerPhone}` : ''
  ].filter(Boolean);
  if (mgrSummaryEl) {
    mgrSummaryEl.textContent = mgrParts.length ? mgrParts.join(' • ') : 'Não configurado';
  }
  if (mgrBtnEl) {
    mgrBtnEl.textContent = mgrParts.length ? 'Editar' : 'Configurar';
  }

  const avatarEl = document.getElementById('headerProfileAvatar');
  const labelEl = document.getElementById('headerProfileLabel');
  if (avatarEl) avatarEl.textContent = getUserInitials(displayName, currentUser?.email || '');
  if (labelEl) labelEl.textContent = String(displayName).split(/\s+/)[0] || 'Perfil';

  const menuFullName = document.getElementById('userMenuFullName');
  const menuSubInfo = document.getElementById('userMenuSubInfo');
  if (menuFullName) menuFullName.textContent = displayName;
  if (menuSubInfo) menuSubInfo.textContent = currentUser?.email || `${ruleLabel} (${settings.stateUf || 'SP'})`;
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

async function renderAnalyticsTab() {
  const analyticsPanel = document.getElementById('tabPanel-graficos');
  const hasData = entries.length > 0;
  document.getElementById('analyticsEmptyState')?.classList.toggle('hidden', hasData);
  document.getElementById('analyticsSubTabs')?.classList.toggle('hidden', !hasData);
  document.getElementById('analyticsPanel-simulador')?.classList.toggle('hidden', !hasData);
  document.getElementById('analyticsPanel-graficos')?.classList.toggle('hidden', !hasData);
  if (!hasData) {
    destroyCharts();
    renderLucideIcons(analyticsPanel);
    return;
  }

  window.requestAnimationFrame(() => {
    const subTabs = document.getElementById('analyticsSubTabs');
    const activeBtn = document.getElementById(`analyticsTabBtn-${activeAnalyticsSubTab}`);
    if (subTabs && activeBtn) syncSlidingTabs(subTabs, activeBtn, { animate: false });
  });

  if (!window.Chart) {
    await ensureChartJs().catch(() => null);
    if (activeMainTab !== 'graficos' || entries.length === 0) return;
  }

  const { chrono, remainingMap } = computeChronologicalAndFIFO(entries);
  renderCharts(chrono, remainingMap, settings, {
    balanceScope: analyticsBalanceScope,
    ratioMode: analyticsRatioMode,
    privacyMode
  });
  renderLucideIcons(analyticsPanel);
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

  document.getElementById('simDaysValue').textContent = `${formatSimulatedDaysLabel(simDays)} (${formatVisibleHHMM(-simMins)})`;
  document.getElementById('simRemainingResult').textContent =
    `${formatVisibleHHMM(remainingMins, true)} (${formatVisibleDays(remainingMins, dailyMins)})`;

  const negWarning = document.getElementById('simNegativeWarning');
  if (negWarning) {
    if (remainingMins < 0) {
      negWarning.textContent = `Atenção: com essa folga você ficaria devendo ${formatVisibleHHMM(Math.abs(remainingMins))} no banco de horas.`;
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
  if (isInitialBalanceEntry(item)) {
    return `<span class="inline-block ${extraClass} px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Saldo Inicial</span>`;
  }
  if (isWriteOffEntry(item)) {
    return `<span class="inline-block ${extraClass} px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">Encerramento / Baixa</span>`;
  }
  if (!item.category || item.category === 'manual') return '';
  const label = ENTRY_CATEGORIES[item.category]?.label || item.category;
  return `<span class="inline-block ${extraClass} px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">${escapeHtml(label)}</span>`;
}

function buildWorkedSubtextHtml(item) {
  if (item.type !== 'credit') return '';
  const worked = Number(item.workedMinutes);
  const mult = Number(item.multiplier || 1);
  if (!worked || (worked === Number(item.minutes) && mult === 1)) return '';
  return `<div class="text-[10px] font-normal text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">Trab. ${formatVisibleHHMM(worked)} × ${mult}x</div>`;
}

function buildActionButtonsHtml(item) {
  const safeId = escapeHtml(item.id);
  const safeTitle = escapeHtml(item.title);
  const quickConfirm = item.status === 'planned'
    ? `<button type="button" data-confirm-id="${safeId}" aria-label="Confirmar ${safeTitle} como realizado" title="Marcar como realizado" class="confirm-realized-btn inline-flex items-center justify-center w-9 h-9 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50 transition"><i data-lucide="check" class="w-4 h-4"></i></button>`
    : '';
  const icsBtn = item.status === 'planned'
    ? `<button type="button" data-ics-id="${safeId}" aria-label="Adicionar ${safeTitle} na agenda (.ics)" title="Baixar evento .ICS" class="ics-entry-btn inline-flex items-center justify-center w-9 h-9 rounded-lg text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/50 transition"><i data-lucide="calendar-plus" class="w-4 h-4"></i></button>`
    : '';
  return `
    ${quickConfirm}
    ${icsBtn}
    <button type="button" data-edit-id="${safeId}" aria-label="Editar lançamento ${safeTitle}" title="Editar" class="edit-entry-btn inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition">
      <i data-lucide="pencil" class="w-4 h-4"></i>
    </button>
    <button type="button" data-delete-id="${safeId}" aria-label="Excluir lançamento ${safeTitle}" title="Excluir" class="delete-entry-btn inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition">
      <i data-lucide="trash-2" class="w-4 h-4"></i>
    </button>
  `;
}

function getMobileCompactCategoryLabel(item) {
  if (isInitialBalanceEntry(item)) return 'Saldo inicial';
  if (isWriteOffEntry(item)) return 'Baixa de saldo';
  const map = {
    holiday: 'Feriado trabalhado',
    overtime: 'Hora extra',
    time_off: 'Folga',
    adjustment: 'Ajuste de saldo'
  };
  if (map[item.category]) return map[item.category];
  return item.type === 'credit' ? 'Crédito' : 'Folga';
}

function getMobileCompactTitle(item) {
  const raw = String(item.title || '').trim();
  if (item.category === 'holiday') {
    const cleaned = raw.replace(/\s*\((?:plant[ãa]o\/)?feriado\)\s*$/i, '').trim();
    if (cleaned) return cleaned;
  }
  return raw;
}

function syncMobileFilterIndicators() {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const fieldsToCheck = isMobile
    ? ['yearFilter']
    : ['yearFilter', 'typeFilter', 'statusFilter'];
  const activeCount = fieldsToCheck
    .filter((id) => (document.getElementById(id)?.value || 'all') !== 'all').length;
  const badge = document.getElementById('mobileFilterBadge');
  const toggleBtn = document.getElementById('mobileFilterToggleBtn');
  if (badge) {
    badge.textContent = String(activeCount);
    badge.classList.toggle('hidden', activeCount === 0);
  }
  if (toggleBtn) {
    toggleBtn.classList.toggle('border-indigo-400', activeCount > 0);
    toggleBtn.classList.toggle('bg-indigo-50/80', activeCount > 0);
    toggleBtn.classList.toggle('dark:border-indigo-700', activeCount > 0);
    toggleBtn.classList.toggle('dark:bg-indigo-950/40', activeCount > 0);
  }

  const searchRow = document.getElementById('mobileSearchRow');
  const searchBtn = document.getElementById('mobileSearchToggleBtn');
  const hasQuery = Boolean(document.getElementById('searchInput')?.value.trim());
  if (hasQuery && searchRow && isMobile) {
    searchRow.classList.add('is-open');
  }
  const searchActive = Boolean(searchRow?.classList.contains('is-open')) || hasQuery;
  if (searchBtn) {
    searchBtn.setAttribute('aria-expanded', String(Boolean(searchRow?.classList.contains('is-open'))));
    searchBtn.classList.toggle('border-indigo-400', searchActive);
    searchBtn.classList.toggle('bg-indigo-50/80', searchActive);
    searchBtn.classList.toggle('dark:border-indigo-700', searchActive);
    searchBtn.classList.toggle('dark:bg-indigo-950/40', searchActive);
  }
}

function syncSearchClearBtnUI() {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('clearSearchBtn');
  if (!input || !btn) return;
  btn.classList.toggle('is-visible', Boolean(input.value));
}

function syncSearchPlaceholder() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  input.placeholder = window.innerWidth < 768
    ? 'Buscar...'
    : 'Buscar por evento, feriado ou observação... (atalho: /)';
}

// ==================== RENDERIZAÇÃO PRINCIPAL ====================
function renderAll() {
  populateYearFilterOptions();
  syncSearchClearBtnUI();
  syncMobileFilterIndicators();
  const { chrono, remainingMap, urgentItems, summary, filtered, hasActiveFilters } = getFilteredEntriesState();
  const todayISO = getLocalDateISO();
  renderedChronoById = new Map(chrono.map((item) => [item.id, item]));
  renderedRemainingMap = remainingMap;

  const prevRealizedMins = lastRenderedRealizedMinutes;
  const nextRealizedText = formatVisibleHHMM(summary.realizedMinutes, true);
  const realizedEl = document.getElementById('kpiRealizedHours');
  if (summary.realizedMinutes > 0) {
    realizedEl.className = 'sh-kpi-value t-subtle-number text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400';
  } else if (summary.realizedMinutes < 0) {
    realizedEl.className = 'sh-kpi-value t-subtle-number text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400';
  } else {
    realizedEl.className = 'sh-kpi-value t-subtle-number text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white';
  }
  setSubtleNumberValue(realizedEl, nextRealizedText, prevRealizedMins, summary.realizedMinutes);
  document.getElementById('kpiRealizedDays').textContent = formatVisibleDays(summary.realizedMinutes, settings.dailyMinutes);

  const projEl = document.getElementById('kpiProjectedHours');
  projEl.textContent = formatVisibleHHMM(summary.projectedMinutes, true);
  if (summary.projectedMinutes < 0) {
    projEl.className = 'sh-kpi-value text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400';
  } else if (summary.projectedMinutes > 0) {
    projEl.className = 'sh-kpi-value text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-indigo-600 dark:text-indigo-400';
  } else {
    projEl.className = 'sh-kpi-value text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white';
  }
  document.getElementById('kpiProjectedDays').textContent = formatVisibleDays(summary.projectedMinutes, settings.dailyMinutes);
  document.getElementById('kpiCreditsHours').textContent = formatVisibleHHMM(summary.creditsMinutes, true);
  document.getElementById('kpiCreditsCount').textContent = `${summary.creditsCount} ${summary.creditsCount === 1 ? 'registro' : 'registros'}`;
  document.getElementById('kpiDebitsHours').textContent = formatVisibleHHMM(-summary.debitsMinutes, false);
  document.getElementById('kpiDebitsCount').textContent = `${summary.debitsCount} ${summary.debitsCount === 1 ? 'folga' : 'folgas'}`;
  document.getElementById('kpiJourneyLabel').textContent = `${formatHHMM(settings.dailyMinutes)}/dia`;

  // Hero Card Unificado Mobile
  const heroRealizedEl = document.getElementById('heroRealizedHours');
  const heroDaysEl = document.getElementById('heroRealizedDays');
  if (heroRealizedEl) {
    if (summary.realizedMinutes > 0) {
      heroRealizedEl.className = 't-subtle-number text-3xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 tracking-tight';
    } else if (summary.realizedMinutes < 0) {
      heroRealizedEl.className = 't-subtle-number text-3xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400 tracking-tight';
    } else {
      heroRealizedEl.className = 't-subtle-number text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight';
    }
    setSubtleNumberValue(heroRealizedEl, nextRealizedText, prevRealizedMins, summary.realizedMinutes);
  }
  lastRenderedRealizedMinutes = summary.realizedMinutes;
  if (heroDaysEl) {
    heroDaysEl.textContent = formatVisibleDays(summary.realizedMinutes, settings.dailyMinutes, true);
    heroDaysEl.className = summary.realizedMinutes < 0
      ? 'text-xs font-semibold px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 tabular-nums'
      : 'text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 tabular-nums';
  }
  const heroProjRow = document.getElementById('heroProjectedRow');
  const heroProjHoursEl = document.getElementById('heroProjectedHours');
  if (heroProjRow && heroProjHoursEl) {
    const hasProjectedDiff = summary.projectedMinutes !== summary.realizedMinutes;
    heroProjRow.classList.toggle('hidden', !hasProjectedDiff);
    heroProjHoursEl.textContent = formatVisibleHHMM(summary.projectedMinutes, true);
  }
  const heroCreditsEl = document.getElementById('heroCreditsHours');
  const heroDebitsEl = document.getElementById('heroDebitsHours');
  if (heroCreditsEl) heroCreditsEl.textContent = formatVisibleHHMM(summary.creditsMinutes, true);
  if (heroDebitsEl) heroDebitsEl.textContent = formatVisibleHHMM(-summary.debitsMinutes, false);

  const secHoursEl = document.getElementById('mobileSecondaryBalanceHours');
  const secDaysEl = document.getElementById('mobileSecondaryBalanceDays');
  if (secHoursEl) {
    secHoursEl.textContent = formatVisibleHHMM(summary.realizedMinutes, true);
    secHoursEl.className = summary.realizedMinutes > 0
      ? 'font-mono font-bold text-emerald-600 dark:text-emerald-400'
      : summary.realizedMinutes < 0
        ? 'font-mono font-bold text-rose-600 dark:text-rose-400'
        : 'font-mono font-bold text-slate-900 dark:text-white';
  }
  if (secDaysEl) {
    secDaysEl.textContent = formatVisibleDays(summary.realizedMinutes, settings.dailyMinutes);
  }

  const alertSummary = buildExpiryAlertSummary(urgentItems, {
    isFilteredExpiring: quickFilter === 'expiring',
    summaryProjectedMinutes: summary.projectedMinutes
  });
  const alertBanner = document.getElementById('expiryAlertBanner');
  if (alertSummary && alertBanner) {
    const toneClasses = alertSummary.tone === 'filtered'
      ? 'min-h-[42px] w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-medium cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-800/80 transition'
      : alertSummary.tone === 'expired'
        ? 'min-h-[42px] w-full rounded-xl border border-rose-200/80 dark:border-rose-800/60 bg-rose-50/80 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-medium cursor-pointer hover:bg-rose-100/70 dark:hover:bg-rose-950/50 transition'
        : 'min-h-[42px] w-full rounded-xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/25 text-amber-900 dark:text-amber-200 px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-medium cursor-pointer hover:bg-amber-100/70 dark:hover:bg-amber-950/45 transition';
    alertBanner.className = toneClasses;
    alertBanner.setAttribute('aria-pressed', String(quickFilter === 'expiring'));

    const iconWrap = document.getElementById('expiryAlertIconWrap');
    if (iconWrap) {
      const iconName = alertSummary.tone === 'filtered' ? 'filter' : 'alert-triangle';
      const iconColor = alertSummary.tone === 'filtered'
        ? 'text-indigo-500 dark:text-indigo-400'
        : alertSummary.tone === 'expired'
          ? 'text-rose-500 dark:text-rose-400'
          : 'text-amber-500 dark:text-amber-400';
      iconWrap.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4 ${iconColor}"></i>`;
    }
    const textEl = document.getElementById('expiryAlertText');
    if (textEl) {
      textEl.textContent = privacyMode
        ? alertSummary.text.replace(/\d{2,}:\d{2}/g, '••:••')
        : alertSummary.text;
    }
    const actionEl = document.getElementById('expiryAlertActionLabel');
    if (actionEl) {
      actionEl.textContent = alertSummary.actionLabel;
      actionEl.className = alertSummary.tone === 'filtered'
        ? 'shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap'
        : alertSummary.tone === 'expired'
          ? 'shrink-0 text-xs font-semibold text-rose-700 dark:text-rose-300 whitespace-nowrap'
          : 'shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap';
    }
  } else if (alertBanner) {
    alertBanner.className = 'hidden';
  }

  syncExpiringQuickPill(alertSummary);

  document.getElementById('clearFiltersBtn').classList.toggle('hidden', !hasActiveFilters);

  const visibleRows = sortAscending ? filtered : [...filtered].reverse();
  const pagedRows = visibleRows.slice(0, entriesVisibleLimit);
  const remainingHiddenCount = Math.max(0, visibleRows.length - pagedRows.length);
  const paginationBar = document.getElementById('entriesPaginationBar');
  const loadMoreBtn = document.getElementById('loadMoreEntriesBtn');

  document.getElementById('filterCounter').textContent =
    `${visibleRows.length} de ${chrono.length} ${chrono.length === 1 ? 'registro' : 'registros'}`;
  const mobileCountEl = document.getElementById('mobileListCount');
  if (mobileCountEl) {
    mobileCountEl.textContent = hasActiveFilters
      ? `(${visibleRows.length}/${chrono.length})`
      : `(${visibleRows.length})`;
  }

  const tbody = document.getElementById('entriesTableBody');
  const mobileContainer = document.getElementById('mobileCardsContainer');
  const emptyState = document.getElementById('emptyState');
  const emptyOnboarding = document.getElementById('emptyOnboarding');
  const emptyFiltered = document.getElementById('emptyFiltered');

  if (visibleRows.length === 0) {
    tbody.innerHTML = '';
    mobileContainer.innerHTML = '';
    paginationBar?.classList.add('hidden');
    emptyState.classList.remove('hidden');
    if (emptyOnboarding && emptyFiltered) {
      emptyOnboarding.classList.toggle('hidden', chrono.length > 0);
      emptyFiltered.classList.toggle('hidden', chrono.length === 0);
    }
  } else {
    emptyState.classList.add('hidden');

    tbody.innerHTML = pagedRows.map((item) => {
      const isCredit = item.type === 'credit';
      const isRealized = item.status === 'realized';
      const remMins = remainingMap.get(item.id) ?? item.minutes;
      const expInfo = isCredit ? getExpiryBadge(item.expiry, remMins, todayISO, item.minutes) : { label: '—', badgeClass: 'text-slate-400' };
      const expLabel = privacyMode && item.expiry
        ? `${formatDateBR(item.expiry)}${expInfo.isExpired ? ' (Vencido)' : ''}`
        : expInfo.label;
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
            <div>${formatVisibleHHMM(item.deltaMinutes, true)}${multTag}</div>
            ${workedSub}
          </td>
          <td class="py-3.5 px-4 text-right font-mono text-xs font-bold tabular-nums whitespace-nowrap text-slate-800 dark:text-slate-200">
            ${formatVisibleHHMM(item.runningMinutes, true)}
          </td>
          <td class="py-3.5 px-4 whitespace-nowrap">
            ${isCredit && item.expiry
          ? `<span class="inline-block px-2 py-0.5 rounded-md border text-[11px] font-medium tabular-nums ${expInfo.badgeClass}">${escapeHtml(expLabel)}</span>`
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

    mobileContainer.innerHTML = pagedRows.map((item) => {
      const safeId = escapeHtml(item.id);
      const isCredit = item.type === 'credit';
      const isRealized = item.status === 'realized';
      const remMins = remainingMap.get(item.id) ?? item.minutes;
      const urgentNote = isCredit ? formatUrgentExpiryCardNote(item, remMins, todayISO) : null;
      const indicatorColor = !isRealized
        ? 'bg-amber-500'
        : isCredit
          ? 'bg-emerald-500'
          : 'bg-rose-500';
      const displayTitle = getMobileCompactTitle(item);
      const simpleCat = getMobileCompactCategoryLabel(item);
      const plannedPill = isRealized
        ? ''
        : '<span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0">Previsto</span>';
      const demoPill = item.isDemo
        ? '<span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 shrink-0">Exemplo</span>'
        : '';
      const urgentDisplayText = urgentNote
        ? (privacyMode ? urgentNote.text.replace(/\d{2,}:\d{2}/g, '••:••') : urgentNote.text)
        : '';
      const urgentLineHtml = urgentNote
        ? `<div class="mt-1 flex items-center gap-1.5 text-[11px] font-medium ${urgentNote.isExpired ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'} min-w-0">
             <span class="w-1.5 h-1.5 rounded-full ${urgentNote.isExpired ? 'bg-rose-500' : 'bg-amber-500'} shrink-0"></span>
             <span class="truncate">${escapeHtml(urgentDisplayText)}</span>
           </div>`
        : '';

      return `
        <button type="button" data-entry-id="${safeId}" class="mobile-entry-card w-full min-h-[64px] text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-3.5 py-2.5 shadow-sm flex items-center justify-between gap-3 active:scale-[0.99] hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition min-w-0">
          <span aria-hidden="true" class="sh-entry-indicator ${indicatorColor}"></span>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm text-slate-900 dark:text-white truncate">${escapeHtml(displayTitle)}</div>
            <div class="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5 min-w-0">
              <span class="font-mono tabular-nums shrink-0">${formatDateBR(item.date)}</span>
              <span aria-hidden="true" class="shrink-0">•</span>
              <span class="truncate">${escapeHtml(simpleCat)}</span>
              ${plannedPill}${demoPill}
            </div>
            ${urgentLineHtml}
          </div>
          <div class="font-mono text-sm font-extrabold tabular-nums whitespace-nowrap shrink-0 ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
            ${formatVisibleHHMM(item.deltaMinutes, true)}
          </div>
        </button>
      `;
    }).join('');

    if (paginationBar && loadMoreBtn) {
      paginationBar.classList.toggle('hidden', remainingHiddenCount === 0);
      if (remainingHiddenCount > 0) {
        loadMoreBtn.textContent = `Ver mais lançamentos (restam ${remainingHiddenCount})`;
      }
    }
  }

  const hasAnyEntries = chrono.length > 0;
  document.getElementById('commEmptyState')?.classList.toggle('hidden', hasAnyEntries);
  document.getElementById('commChannelTabs')?.classList.toggle('hidden', !hasAnyEntries);
  document.getElementById('commChannelsGrid')?.classList.toggle('hidden', !hasAnyEntries);
  if (hasAnyEntries && activeMainTab === 'comunicacao') {
    window.requestAnimationFrame(() => syncCommChannelPill(false));
  }

  updateSimulator(summary.projectedMinutes);
  const { emailText, whatsappText } = buildCommunicationTemplates(chrono, settings);
  defaultTemplatesCache = { emailTemplate: emailText, whatsappTemplate: whatsappText };
  document.getElementById('emailTemplate').value = emailText;
  document.getElementById('whatsappTemplate').value = whatsappText;
  syncTemplateResetButton('emailTemplate');
  syncTemplateResetButton('whatsappTemplate');

  if (!document.getElementById('tabPanel-graficos').classList.contains('hidden')) {
    renderAnalyticsTab();
  }
  renderLucideIcons(document.getElementById('tabPanel-extrato'));
}

function syncTemplateResetButton(templateId) {
  const el = document.getElementById(templateId);
  const resetBtn = document.querySelector(`[data-for-template="${templateId}"]`);
  if (!el || !resetBtn) return;
  const isModified = el.value !== (defaultTemplatesCache[templateId] ?? '');
  resetBtn.classList.toggle('hidden', !isModified);
  resetBtn.classList.toggle('inline-flex', isModified);
}

// ==================== DELEGAÇÃO DE AÇÕES NO EXTRATO ====================
async function handleConfirmRealized(id, btn) {
  if (!btn || btn.dataset.busy === '1' || !hasActiveWorkspace()) return;
  const target = entries.find((e) => e.id === id);
  if (!target || target.status === 'realized') return;

  btn.dataset.busy = '1';
  btn.disabled = true;

  const snapshot = [...entries];
  const updated = { ...target, status: 'realized' };
  entries = entries.map((e) => (e.id === id ? updated : e));
  persistCurrentUserSnapshot();

  if (isGuestMode && !currentUser) {
    setSyncStatus('local');
    renderAll();
    showToast(`"${updated.title}" marcado como realizado!`);
    delete btn.dataset.busy;
    btn.disabled = false;
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueueLocalSync({ kind: 'upsert', entry: updated });
    setSyncStatus('offline');
    renderAll();
    showToast(`"${updated.title}" confirmado no aparelho!`);
    delete btn.dataset.busy;
    btn.disabled = false;
    return;
  }

  renderAll();
  try {
    await upsertEntryToCloud(currentUser.id, updated, setSyncStatus);
    clearSyncedQueueOps((op) => op.kind !== 'settings' && (op.id === updated.id || op.entry?.id === updated.id));
    showToast(`"${updated.title}" marcado como realizado!`);
    void flushPendingSyncQueue({ showSyncedToast: false });
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueLocalSync({ kind: 'upsert', entry: updated });
      setSyncStatus('offline');
      showToast('Sem conexão — confirmação salva na fila local');
    } else {
      entries = snapshot;
      persistCurrentUserSnapshot();
      renderAll();
      showToast('Erro ao confirmar na nuvem — alteração revertida');
    }
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
    }
  }
}

async function restoreDeletedEntry(deletedItem) {
  if (!hasActiveWorkspace()) return;
  if (!entries.some((x) => x.id === deletedItem.id)) {
    entries.push(deletedItem);
    persistCurrentUserSnapshot();
  }

  if (isGuestMode && !currentUser) {
    setSyncStatus('local');
    renderAll();
    showToast('Lançamento restaurado!');
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueueLocalSync({ kind: 'upsert', entry: deletedItem });
    setSyncStatus('offline');
    renderAll();
    showToast('Lançamento restaurado no aparelho!');
    return;
  }

  renderAll();
  try {
    await upsertEntryToCloud(currentUser.id, deletedItem, setSyncStatus);
    clearSyncedQueueOps((op) => op.kind !== 'settings' && (op.id === deletedItem.id || op.entry?.id === deletedItem.id));
    showToast('Lançamento restaurado!');
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueLocalSync({ kind: 'upsert', entry: deletedItem });
      setSyncStatus('offline');
      showToast('Sem conexão — restauração salva localmente!');
    } else {
      entries = entries.filter((x) => x.id !== deletedItem.id);
      persistCurrentUserSnapshot();
      renderAll();
      showToast('Erro ao restaurar lançamento na nuvem');
    }
  }
}

async function handleDeleteEntry(id) {
  const item = entries.find((e) => e.id === id);
  if (!item || !hasActiveWorkspace()) return;

  const confirmed = await modals.confirmDialog({
    title: 'Excluir lançamento?',
    message: `Deseja realmente excluir "${item.title}" (${formatDateBR(item.date)} • ${formatHHMM(item.minutes)})?`,
    confirmText: 'Sim, excluir',
    cancelText: 'Cancelar',
    variant: 'danger'
  });
  if (!confirmed) return;

  const deletedItem = { ...item };
  const snapshot = [...entries];
  entries = entries.filter((e) => e.id !== id);
  persistCurrentUserSnapshot();

  const undoToastOpts = {
    actionLabel: 'Desfazer',
    duration: 5500,
    onAction: () => restoreDeletedEntry(deletedItem)
  };

  if (isGuestMode && !currentUser) {
    setSyncStatus('local');
    renderAll();
    showToast(`"${deletedItem.title}" excluído`, undoToastOpts);
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueueLocalSync({ kind: 'delete', id });
    setSyncStatus('offline');
    renderAll();
    showToast(`"${deletedItem.title}" excluído (offline)`, undoToastOpts);
    return;
  }

  renderAll();
  try {
    await deleteEntryFromCloud(currentUser.id, id, setSyncStatus);
    clearSyncedQueueOps((op) => op.kind !== 'settings' && (op.id === id || op.entry?.id === id));
    showToast(`"${deletedItem.title}" excluído`, undoToastOpts);
    void flushPendingSyncQueue({ showSyncedToast: false });
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueLocalSync({ kind: 'delete', id });
      setSyncStatus('offline');
      showToast(`"${deletedItem.title}" excluído (na fila local)`, undoToastOpts);
    } else {
      entries = snapshot;
      persistCurrentUserSnapshot();
      renderAll();
      showToast('Erro ao excluir — registro restaurado');
    }
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

function closeEntryDetailModal() {
  const modal = document.getElementById('entryDetailModal');
  if (!modal || !isLayerOpen(modal)) return;
  closeAnimatedModal(modal);
  activeDetailEntryId = null;
  modals.restoreLastFocus();
}

function openEntryDetailModal(item) {
  const modal = document.getElementById('entryDetailModal');
  if (!modal || !item) return;

  modals.captureLastFocus();
  activeDetailEntryId = item.id;

  const isCredit = item.type === 'credit';
  const isRealized = item.status === 'realized';
  const todayISO = getLocalDateISO();
  const deltaMins = item.deltaMinutes ?? (isCredit ? item.minutes : -item.minutes);
  const fullCategory = ENTRY_CATEGORIES[item.category]?.label || ENTRY_CATEGORIES.manual.label;
  const remMins = renderedRemainingMap.get(item.id) ?? item.minutes;

  document.getElementById('entryDetailTitle').textContent = item.title || 'Detalhes do lançamento';
  document.getElementById('entryDetailSubtitle').textContent = `${getMobileCompactCategoryLabel(item)} • ${formatDateBR(item.date)}`;

  const statusBadge = document.getElementById('entryDetailStatusBadge');
  statusBadge.textContent = isRealized ? 'Realizado' : 'Previsto';
  statusBadge.className = isRealized
    ? 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
    : 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';

  document.getElementById('entryDetailTypeLabel').textContent = isCredit ? 'Crédito no banco' : 'Folga / saída';
  const deltaEl = document.getElementById('entryDetailDelta');
  deltaEl.textContent = formatVisibleHHMM(deltaMins, true);
  deltaEl.className = `text-2xl font-extrabold font-mono tabular-nums ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  document.getElementById('entryDetailRunning').textContent = formatVisibleHHMM(item.runningMinutes ?? 0, true);
  document.getElementById('entryDetailDate').textContent = formatDateBR(item.date);
  document.getElementById('entryDetailCategory').textContent = fullCategory;

  const calcTextEl = document.getElementById('entryDetailCalcText');
  if (isCredit) {
    const worked = Number(item.workedMinutes) > 0 ? Number(item.workedMinutes) : Number(item.minutes);
    const mult = Number(item.multiplier || 1);
    calcTextEl.textContent = `Trabalhado ${formatVisibleHHMM(worked)} × ${mult}x`;
  } else {
    calcTextEl.textContent = `${formatVisibleHHMM(item.minutes)} (${formatVisibleDays(item.minutes, settings.dailyMinutes)})`;
  }

  const expiryRow = document.getElementById('entryDetailExpiryRow');
  const expiryText = document.getElementById('entryDetailExpiryText');
  const showExpiry = isCredit && Boolean(item.expiry);
  const expInfo = showExpiry ? getExpiryBadge(item.expiry, remMins, todayISO, item.minutes) : null;
  expiryRow.classList.toggle('hidden', !showExpiry);
  expiryRow.classList.toggle('flex', showExpiry);
  if (showExpiry && expInfo) {
    const expBadgeLabel = privacyMode
      ? (expInfo.isExpired ? 'Vencido' : 'Prazo ativo')
      : expInfo.label;
    expiryText.textContent = `${formatDateBR(item.expiry)} (${expBadgeLabel})`;
  }

  const notesRow = document.getElementById('entryDetailNotesRow');
  const notesText = document.getElementById('entryDetailNotesText');
  const hasNotes = Boolean(item.notes && String(item.notes).trim());
  notesRow.classList.toggle('hidden', !hasNotes);
  notesText.textContent = hasNotes ? item.notes : '';

  const plannedBox = document.getElementById('entryDetailPlannedActions');
  plannedBox.classList.toggle('hidden', isRealized);
  plannedBox.classList.toggle('grid', !isRealized);

  const canWriteOff = Boolean(isCredit && remMins > 0 && (expInfo?.isExpired || expInfo?.isAlert));
  const writeOffBtn = document.getElementById('entryDetailWriteOffBtn');
  if (writeOffBtn) {
    writeOffBtn.classList.toggle('hidden', !canWriteOff);
    writeOffBtn.classList.toggle('flex', canWriteOff);
  }

  openAnimatedModal(modal);
  renderLucideIcons(modal);
}

document.getElementById('entriesTableBody').addEventListener('click', handleEntryActionClick);
document.getElementById('mobileCardsContainer').addEventListener('click', (e) => {
  const cardBtn = e.target.closest('.mobile-entry-card');
  if (!cardBtn) return;
  const entryId = cardBtn.dataset.entryId;
  const item = renderedChronoById.get(entryId) || entries.find((x) => x.id === entryId);
  if (item) openEntryDetailModal(item);
});

document.getElementById('entryDetailModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'entryDetailModal') closeEntryDetailModal();
});
document.getElementById('closeEntryDetailBtn')?.addEventListener('click', closeEntryDetailModal);

document.getElementById('entryDetailConfirmBtn')?.addEventListener('click', async (e) => {
  const id = activeDetailEntryId;
  if (!id) return;
  const btn = e.currentTarget;
  closeEntryDetailModal();
  await handleConfirmRealized(id, btn);
});

document.getElementById('entryDetailIcsBtn')?.addEventListener('click', () => {
  const target = entries.find((item) => item.id === activeDetailEntryId);
  if (!target) return;
  const evs = buildCalendarEventsFromEntries([target], new Map(), settings);
  downloadIcsEvents(evs, `saldohoras-${target.date}.ics`);
  showToast('Evento .ICS baixado para sua agenda!');
});

document.getElementById('entryDetailEditBtn')?.addEventListener('click', () => {
  const target = entries.find((item) => item.id === activeDetailEntryId);
  if (!target) return;
  closeEntryDetailModal();
  modals.openEntryModal(target, true);
});

document.getElementById('entryDetailDeleteBtn')?.addEventListener('click', () => {
  const id = activeDetailEntryId;
  if (!id) return;
  closeEntryDetailModal();
  handleDeleteEntry(id);
});

document.getElementById('entryDetailWriteOffBtn')?.addEventListener('click', () => {
  const target = entries.find((item) => item.id === activeDetailEntryId);
  if (!target) return;
  const rem = renderedRemainingMap.get(target.id) ?? target.minutes;
  closeEntryDetailModal();
  modals.openWriteOffModal(target, rem);
});

// ==================== FILTROS, ABAS & ATALHOS ====================
function syncExpiringQuickPill(alertSummary) {
  const expPill = document.getElementById('pill-expiring');
  const allPill = document.getElementById('pill-all');
  const clearBtn = document.getElementById('clearFiltersBtn');
  const labelEl = document.getElementById('pillExpiringLabel');
  const dotEl = document.getElementById('pillExpiringDot');
  if (!expPill) return;

  const hasUrgent = Boolean(alertSummary && alertSummary.count > 0);
  if (hasUrgent) {
    if (labelEl) labelEl.textContent = `Vencendo (${alertSummary.count})`;
    expPill.classList.remove('hidden');
    expPill.classList.add('inline-flex');
    if (allPill && expPill.previousElementSibling !== allPill) {
      allPill.after(expPill);
    }
    if (dotEl) {
      const isActive = quickFilter === 'expiring';
      dotEl.className = alertSummary.hasExpired
        ? `w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-rose-200' : 'bg-rose-500'}`
        : `w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-amber-200' : 'bg-amber-500'}`;
    }
  } else {
    expPill.classList.add('hidden');
    expPill.classList.remove('inline-flex');
    if (clearBtn && expPill.nextElementSibling !== clearBtn) {
      clearBtn.before(expPill);
    }
  }
}

function setQuickPillVisual(filterName) {
  const inactiveClasses = ['bg-slate-100', 'text-slate-600', 'hover:bg-slate-200', 'dark:bg-slate-800', 'dark:text-slate-300', 'dark:hover:bg-slate-700'];
  const activeClasses = ['bg-indigo-600', 'text-white'];
  document.querySelectorAll('.quick-pill').forEach((btn) => {
    const isSelected = btn.id === `pill-${filterName}`;
    btn.classList.remove(...(isSelected ? inactiveClasses : activeClasses));
    btn.classList.add(...(isSelected ? activeClasses : inactiveClasses));
  });
}

function applyQuickFilter(filterName) {
  quickFilter = filterName;
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  if (filterName !== 'all') {
    const tf = document.getElementById('typeFilter');
    const sf = document.getElementById('statusFilter');
    if (tf) tf.value = 'all';
    if (sf) sf.value = 'all';
  }
  setQuickPillVisual(filterName);
  renderAll();
  const activePill = document.getElementById(`pill-${filterName}`);
  if (activePill && !activePill.classList.contains('hidden')) {
    activePill.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' });
  }
}

function switchAnalyticsSubTab(subTab, { animate = true } = {}) {
  activeAnalyticsSubTab = subTab === 'graficos' ? 'graficos' : 'simulador';
  const tabsBar = document.getElementById('analyticsSubTabs');
  const simPanel = document.getElementById('analyticsPanel-simulador');
  const chartPanel = document.getElementById('analyticsPanel-graficos');
  const simBtn = document.getElementById('analyticsTabBtn-simulador');
  const chartBtn = document.getElementById('analyticsTabBtn-graficos');
  const activeCls = 't-tab sh-touch-h44 px-3 py-2 text-xs font-semibold rounded-lg text-slate-900 dark:text-white';
  const inactiveCls = 't-tab sh-touch-h44 px-3 py-2 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';

  const showCharts = activeAnalyticsSubTab === 'graficos';
  simPanel?.classList.toggle('sh-mobile-hidden-panel', showCharts);
  chartPanel?.classList.toggle('sh-mobile-hidden-panel', !showCharts);
  if (simBtn) {
    simBtn.className = showCharts ? inactiveCls : activeCls;
    simBtn.setAttribute('aria-selected', String(!showCharts));
  }
  if (chartBtn) {
    chartBtn.className = showCharts ? activeCls : inactiveCls;
    chartBtn.setAttribute('aria-selected', String(showCharts));
  }
  if (tabsBar) {
    const activeBtn = showCharts ? chartBtn : simBtn;
    if (activeBtn) syncSlidingTabs(tabsBar, activeBtn, { animate });
  }
  if (showCharts && activeMainTab === 'graficos') {
    window.requestAnimationFrame(() => renderAnalyticsTab());
  }
}

document.querySelectorAll('[data-analytics-subtab]').forEach((btn) => {
  btn.addEventListener('click', () => switchAnalyticsSubTab(btn.dataset.analyticsSubtab));
});

function switchMainTab(tabName, { animate = true } = {}) {
  activeMainTab = tabName;
  const tabsBar = document.getElementById('mainTabsBar');
  let activeDesktopBtn = null;
  ['extrato', 'graficos', 'comunicacao'].forEach((t) => {
    document.getElementById(`tabPanel-${t}`).classList.toggle('hidden', t !== tabName);
    const btn = document.getElementById(`tabBtn-${t}`);
    if (btn) {
      const isSelected = t === tabName;
      btn.setAttribute('aria-selected', String(isSelected));
      btn.className = isSelected
        ? 'main-tab-btn t-tab px-4 py-3 text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap flex items-center gap-2'
        : 'main-tab-btn t-tab px-4 py-3 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap flex items-center gap-2';
      if (isSelected) activeDesktopBtn = btn;
    }
    const mobBtn = document.getElementById(`mobileNavBtn-${t}`);
    if (mobBtn) {
      mobBtn.className = t === tabName
        ? 'mobile-nav-tab-btn flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 min-w-0'
        : 'mobile-nav-tab-btn flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 min-w-0';
      const pill = mobBtn.querySelector('.mobile-nav-pill');
      if (pill) {
        pill.className = t === tabName
          ? 'mobile-nav-pill h-7 px-3.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center transition'
          : 'mobile-nav-pill h-7 px-3.5 rounded-full flex items-center justify-center transition';
      }
    }
    const deskNavBtn = document.getElementById(`desktopNavBtn-${t}`);
    if (deskNavBtn) {
      const isSelected = t === tabName;
      deskNavBtn.classList.toggle('is-active', isSelected);
      if (isSelected) deskNavBtn.setAttribute('aria-current', 'page');
      else deskNavBtn.removeAttribute('aria-current');
    }
  });

  if (tabsBar && activeDesktopBtn) {
    syncSlidingTabs(tabsBar, activeDesktopBtn, { animate });
  }

  const secBar = document.getElementById('mobileSecondarySummaryBar');
  const secTitle = document.getElementById('mobileSecondaryTabTitle');
  if (secBar) {
    const showSecondary = tabName === 'graficos' || tabName === 'comunicacao';
    secBar.classList.toggle('hidden', !showSecondary);
    if (secTitle && showSecondary) {
      secTitle.textContent = tabName === 'graficos' ? 'Gráficos' : 'Comunicação RH';
    }
  }

  if (tabName === 'graficos') {
    window.requestAnimationFrame(() => renderAnalyticsTab());
  } else if (tabName === 'comunicacao') {
    window.requestAnimationFrame(() => syncCommChannelPill(false));
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
  const woBtn = e.target.closest('.writeoff-bucket-btn');
  if (woBtn) {
    const bucketId = woBtn.dataset.bucketId;
    const target = entries.find((item) => item.id === bucketId);
    const rem = renderedRemainingMap.get(bucketId) ?? (target ? target.minutes : 0);
    if (target) modals.openWriteOffModal(target, rem);
    return;
  }

  const btn = e.target.closest('.sim-from-bucket-btn');
  if (!btn) return;
  const remMins = Number(btn.dataset.simMinutes) || 0;
  const dailyMins = Math.max(60, Number(settings.dailyMinutes) || 480);
  const suggestedDays = Math.max(0.5, Math.ceil((remMins / dailyMins) * 2) / 2);
  const slider = document.getElementById('simDaysSlider');
  if (Number(slider.max) < suggestedDays) slider.max = String(Math.ceil(suggestedDays));
  slider.value = String(suggestedDays);
  updateSimulator();
  slider.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  showToast(`Simulador ajustado para ${formatSimulatedDaysLabel(suggestedDays)} (${formatVisibleHHMM(remMins)} a vencer)`);
});

function resetAllFilters() {
  clearTimeout(searchDebounceTimer);
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  document.getElementById('searchInput').value = '';
  document.getElementById('yearFilter').value = 'all';
  document.getElementById('typeFilter').value = 'all';
  document.getElementById('statusFilter').value = 'all';
  document.getElementById('mobileSearchRow')?.classList.remove('is-open');
  syncSearchClearBtnUI();
  applyQuickFilter('all');
}

document.querySelectorAll('.quick-pill').forEach((btn) => {
  btn.addEventListener('click', () => applyQuickFilter(btn.dataset.quickFilter));
});
document.getElementById('expiryAlertBanner')?.addEventListener('click', () => {
  applyQuickFilter(quickFilter === 'expiring' ? 'all' : 'expiring');
});
document.getElementById('clearFiltersBtn').addEventListener('click', resetAllFilters);
document.getElementById('emptyClearFiltersBtn')?.addEventListener('click', resetAllFilters);
document.getElementById('onboardingNewEntryBtn')?.addEventListener('click', () => modals.openEntryIntentModal());
document.getElementById('mobilePrivacyToggleBtn')?.addEventListener('click', togglePrivacyMode);
document.getElementById('desktopPrivacyToggleBtn')?.addEventListener('click', togglePrivacyMode);
document.getElementById('openInitialBalanceBtn')?.addEventListener('click', () => {
  closeUserMenu();
  modals.openInitialSetupModal({ startStep: 2, adjustOnly: true });
});
document.getElementById('emptySetInitialBalanceBtn')?.addEventListener('click', () => {
  modals.openInitialSetupModal({ startStep: 2, adjustOnly: true });
});
document.getElementById('analyticsEmptyInitialBtn')?.addEventListener('click', () => {
  modals.openInitialSetupModal({ startStep: 2, adjustOnly: true });
});
document.getElementById('analyticsEmptyNewBtn')?.addEventListener('click', () => modals.openEntryIntentModal());
document.getElementById('commEmptyNewBtn')?.addEventListener('click', () => modals.openEntryIntentModal());

document.getElementById('searchInput').addEventListener('input', () => {
  syncSearchClearBtnUI();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    entriesVisibleLimit = ENTRIES_PAGE_SIZE;
    renderAll();
  }, 180);
});
document.getElementById('clearSearchBtn')?.addEventListener('click', () => {
  const input = document.getElementById('searchInput');
  if (!input) return;
  clearTimeout(searchDebounceTimer);
  input.value = '';
  syncSearchClearBtnUI();
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  renderAll();
  input.focus();
});
document.getElementById('loadMoreEntriesBtn')?.addEventListener('click', () => {
  entriesVisibleLimit += ENTRIES_PAGE_SIZE;
  renderAll();
});
document.getElementById('yearFilter').addEventListener('change', () => {
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  renderAll();
});
document.getElementById('typeFilter').addEventListener('change', () => {
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  quickFilter = 'all';
  setQuickPillVisual('all');
  renderAll();
});
document.getElementById('statusFilter').addEventListener('change', () => {
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  quickFilter = 'all';
  setQuickPillVisual('all');
  renderAll();
});

function toggleSortOrder() {
  sortAscending = !sortAscending;
  entriesVisibleLimit = ENTRIES_PAGE_SIZE;
  const label = sortAscending ? 'Mais antigos' : 'Mais recentes';
  document.getElementById('sortOrderLabel').textContent = label;
  const mirrorBtn = document.getElementById('mobileSortMirrorBtn');
  if (mirrorBtn) {
    mirrorBtn.title = label;
    mirrorBtn.setAttribute('aria-label', `Ordenação: ${label}`);
  }
  renderAll();
}

document.getElementById('sortOrderBtn').addEventListener('click', toggleSortOrder);
document.getElementById('mobileSortMirrorBtn')?.addEventListener('click', toggleSortOrder);
document.getElementById('heroRuleEditBtn')?.addEventListener('click', () => modals.openSettingsModal());
document.getElementById('mobileSearchToggleBtn')?.addEventListener('click', () => {
  const searchRow = document.getElementById('mobileSearchRow');
  const searchInput = document.getElementById('searchInput');
  if (!searchRow) return;
  const isOpen = searchRow.classList.toggle('is-open');
  syncMobileFilterIndicators();
  if (isOpen && searchInput) {
    setTimeout(() => searchInput.focus(), 40);
  }
});
document.getElementById('mobileFilterToggleBtn')?.addEventListener('click', () => {
  const drawer = document.getElementById('filterSelectsGroup');
  const btn = document.getElementById('mobileFilterToggleBtn');
  if (!drawer) return;
  const isOpen = drawer.classList.toggle('is-open');
  btn?.setAttribute('aria-expanded', String(isOpen));
});

document.querySelectorAll('.main-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchMainTab(btn.dataset.mainTab));
});

document.querySelectorAll('.mobile-nav-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchMainTab(btn.dataset.mobileNav);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
});

// Botões de abertura de modais
document.getElementById('openNewEntryBtn').addEventListener('click', () => modals.openEntryIntentModal());
document.getElementById('mobileNavNewEntryBtn')?.addEventListener('click', () => modals.openEntryIntentModal());
document.getElementById('openSettingsBtn').addEventListener('click', () => {
  closeUserMenu();
  modals.openSettingsModal();
});
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
    status: 'planned'
  }, false, { source: 'simulator' });
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
['emailTemplate', 'whatsappTemplate'].forEach((templateId) => {
  document.getElementById(templateId)?.addEventListener('input', () => syncTemplateResetButton(templateId));
});

document.querySelectorAll('[data-action="regen-messages"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const { chrono } = computeChronologicalAndFIFO(entries);
    const { emailText, whatsappText } = buildCommunicationTemplates(chrono, settings);
    defaultTemplatesCache = { emailTemplate: emailText, whatsappTemplate: whatsappText };
    const targetId = btn.dataset.forTemplate;
    if (targetId === 'emailTemplate') {
      document.getElementById('emailTemplate').value = emailText;
      syncTemplateResetButton('emailTemplate');
    } else if (targetId === 'whatsappTemplate') {
      document.getElementById('whatsappTemplate').value = whatsappText;
      syncTemplateResetButton('whatsappTemplate');
    } else {
      document.getElementById('emailTemplate').value = emailText;
      document.getElementById('whatsappTemplate').value = whatsappText;
      syncTemplateResetButton('emailTemplate');
      syncTemplateResetButton('whatsappTemplate');
    }
    showToast('Texto restaurado para o padrão!');
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

function syncCommChannelPill(animate = false) {
  const tabsBar = document.getElementById('commChannelTabs');
  const activeBtn = tabsBar?.querySelector('[aria-selected="true"]');
  if (tabsBar && activeBtn) syncSlidingTabs(tabsBar, activeBtn, { animate });
}

function switchCommChannel(channel, { animate = true } = {}) {
  const tabsBar = document.getElementById('commChannelTabs');
  const emailCard = document.getElementById('commCardEmail');
  const waCard = document.getElementById('commCardWhatsapp');
  const emailBtn = document.getElementById('commTabBtn-email');
  const waBtn = document.getElementById('commTabBtn-whatsapp');
  const activeCls = 't-tab sh-touch-h44 px-3 py-2 text-xs font-semibold rounded-lg text-slate-900 dark:text-white';
  const inactiveCls = 't-tab sh-touch-h44 px-3 py-2 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';

  const isEmail = channel === 'email';
  emailCard?.classList.toggle('sh-mobile-hidden-panel', !isEmail);
  waCard?.classList.toggle('sh-mobile-hidden-panel', isEmail);
  if (emailBtn) {
    emailBtn.className = isEmail ? activeCls : inactiveCls;
    emailBtn.setAttribute('aria-selected', String(isEmail));
  }
  if (waBtn) {
    waBtn.className = isEmail ? inactiveCls : activeCls;
    waBtn.setAttribute('aria-selected', String(!isEmail));
  }
  if (tabsBar) {
    const activeBtn = isEmail ? emailBtn : waBtn;
    if (activeBtn) syncSlidingTabs(tabsBar, activeBtn, { animate });
  }
}

document.getElementById('commTabBtn-whatsapp')?.addEventListener('click', () => switchCommChannel('whatsapp'));
document.getElementById('commTabBtn-email')?.addEventListener('click', () => switchCommChannel('email'));

document.getElementById('toggleCommManagerBtn')?.addEventListener('click', () => {
  const form = document.getElementById('commManagerForm');
  const btn = document.getElementById('toggleCommManagerBtn');
  if (!form) return;
  const willOpen = form.classList.contains('hidden');
  clearAllInlineErrors(form);
  form.classList.toggle('hidden', !willOpen);
  btn?.setAttribute('aria-expanded', String(willOpen));
});

document.getElementById('commManagerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  clearAllInlineErrors(form);
  const rawEmail = document.getElementById('settingManagerEmail')?.value.trim() || '';
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    triggerInlineFieldError('commManagerEmailWrap', 'settingManagerEmail', 'Informe um e-mail válido (ou deixe vazio).');
    return;
  }
  const nextSettings = {
    ...settings,
    managerEmail: rawEmail,
    managerPhone: document.getElementById('settingManagerPhone')?.value.replace(/\D/g, '') || ''
  };
  const ok = await persistSettings(nextSettings, { silentToast: true });
  if (ok) {
    document.getElementById('commManagerForm')?.classList.add('hidden');
    document.getElementById('toggleCommManagerBtn')?.setAttribute('aria-expanded', 'false');
    showToast('Contato do gestor atualizado!');
  }
});

document.getElementById('openWhatsAppBtn').addEventListener('click', () => {
  const text = encodeURIComponent(document.getElementById('whatsappTemplate').value);
  const phone = settings.managerPhone || '';
  window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
});

// Exportações, Menu da Conta & Backup JSON
function closeExportMenu() {
  const dd = document.getElementById('exportDropdown');
  if (isLayerOpen(dd)) closeAnimatedDropdown(dd);
  document.getElementById('exportMenuBtn')?.setAttribute('aria-expanded', 'false');
}

function closeUserMenu() {
  const dd = document.getElementById('userDropdown');
  const backdrop = document.getElementById('userMenuBackdrop');
  if (isLayerOpen(dd)) closeAnimatedDropdown(dd);
  if (backdrop && !backdrop.classList.contains('hidden')) {
    backdrop.classList.remove('is-open');
    const closeMs = readCssMs('--modal-close-dur', 150) + 16;
    clearTimeout(backdrop._hideTimer);
    backdrop._hideTimer = setTimeout(() => {
      if (!backdrop.classList.contains('is-open')) backdrop.classList.add('hidden');
    }, closeMs);
  }
  document.getElementById('userMenuBtn')?.setAttribute('aria-expanded', 'false');
}

function openUserMenu() {
  const dd = document.getElementById('userDropdown');
  const backdrop = document.getElementById('userMenuBackdrop');
  if (!dd) return;
  syncInstallAppMenuVisibility();
  openAnimatedDropdown(dd);
  if (backdrop && window.innerWidth < 768) {
    clearTimeout(backdrop._hideTimer);
    backdrop.classList.remove('hidden');
    void backdrop.offsetWidth;
    backdrop.classList.add('is-open');
  }
  document.getElementById('userMenuBtn')?.setAttribute('aria-expanded', 'true');
}

document.getElementById('exportMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeUserMenu();
  const dd = document.getElementById('exportDropdown');
  const opening = !isLayerOpen(dd);
  if (opening) openAnimatedDropdown(dd);
  else closeAnimatedDropdown(dd);
  document.getElementById('exportMenuBtn')?.setAttribute('aria-expanded', String(opening));
  if (opening) updateQuickExportCountHint();
});

document.getElementById('userMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeExportMenu();
  const dd = document.getElementById('userDropdown');
  if (!dd) return;
  const opening = !isLayerOpen(dd);
  if (opening) openUserMenu();
  else closeUserMenu();
});

document.getElementById('userMenuBackdrop')?.addEventListener('click', closeUserMenu);

document.addEventListener('click', (e) => {
  if (!document.getElementById('exportMenuWrapper')?.contains(e.target)) closeExportMenu();
  if (!document.getElementById('userMenuWrapper')?.contains(e.target)) closeUserMenu();
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
    await ensureJsPdf().catch((loadErr) => {
      throw Object.assign(new Error(loadErr?.message || 'jsPDF indisponível'), { code: 'JSPDF_UNAVAILABLE' });
    });
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
    showToast('Planilha Excel (.xlsx) exportada!');
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

document.getElementById('exportJsonMenuBtn').addEventListener('click', async () => {
  const { chrono } = computeChronologicalAndFIFO(entries);
  const code = await computeIntegrityDigest(chrono, settings, 'Backup Completo do Aplicativo');
  exportJSONBackup(settings, entries, code);
  closeExportMenu();
  showToast('Backup do aplicativo baixado!');
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
    await ensureJsPdf().catch((loadErr) => {
      throw Object.assign(new Error(loadErr?.message || 'jsPDF indisponível'), { code: 'JSPDF_UNAVAILABLE' });
    });
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
  if (!file || !hasActiveWorkspace()) return;

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

      persistCurrentUserSnapshot();

      if (isGuestMode && !currentUser) {
        setSyncStatus('local');
        updateHeaderUserInfo();
        modals.closeSettingsModal();
        exportModal.closeExportModal();
        renderAll();
        showToast(`Backup importado localmente (${validEntries.length} registros)!`);
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (parsed.settings) enqueueLocalSync({ kind: 'settings', settings });
        validEntries.forEach((clean) => enqueueLocalSync({ kind: 'upsert', entry: clean }));
        setSyncStatus('offline');
        updateHeaderUserInfo();
        modals.closeSettingsModal();
        exportModal.closeExportModal();
        renderAll();
        showToast(`Backup aplicado localmente (${validEntries.length} registros)!`);
        return;
      }

      try {
        if (parsed.settings) {
          await saveSettingsToCloud(currentUser.id, settings, setSyncStatus);
          clearSyncedQueueOps((op) => op.kind === 'settings');
        }
        await upsertEntriesBatchToCloud(currentUser.id, validEntries, setSyncStatus);
        const importedIds = new Set(validEntries.map((clean) => clean.id));
        clearSyncedQueueOps((op) => op.kind !== 'settings' && importedIds.has(op.id || op.entry?.id));
        updateHeaderUserInfo();
        modals.closeSettingsModal();
        exportModal.closeExportModal();
        renderAll();
        showToast(`Backup importado (${validEntries.length} registros)!`);
        void flushPendingSyncQueue({ showSyncedToast: false });
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          if (parsed.settings) enqueueLocalSync({ kind: 'settings', settings });
          validEntries.forEach((clean) => enqueueLocalSync({ kind: 'upsert', entry: clean }));
          setSyncStatus('offline');
          updateHeaderUserInfo();
          modals.closeSettingsModal();
          exportModal.closeExportModal();
          renderAll();
          showToast(`Sem conexão — backup salvo na fila local (${validEntries.length} registros)`);
          return;
        }
        settings = prevSettings;
        entries = prevEntries;
        persistCurrentUserSnapshot();
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

modals.registerExternalModal('entryDetailModal', closeEntryDetailModal);
document.getElementById('commOpenExportBtn')?.addEventListener('click', () => exportModal.openExportModal());

// Navegação superior desktop (>= 1024px)
document.querySelectorAll('[data-desktop-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchMainTab(btn.dataset.desktopNav, { animate: false });
  });
});
document.getElementById('desktopNavHolidaysBtn')?.addEventListener('click', () => modals.openHolidaysModal());

// Atalhos de teclado globais
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modals.handleEscapeKey()) return;
    closeExportMenu();
    closeUserMenu();
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const activeEl = document.activeElement;
    const tag = activeEl?.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || activeEl?.isContentEditable) {
      return;
    }

    // Sub-painel "Calcular pelo ponto": Enter aplica duração em vez de enviar o formulário antes da hora
    const punchPanel = document.getElementById('punchCalcPanel');
    if (punchPanel && !punchPanel.classList.contains('hidden') && punchPanel.contains(activeEl)) {
      e.preventDefault();
      document.getElementById('applyPunchCalcBtn')?.click();
      return;
    }

    // Modal Saldo Inicial: Enter avança ou conclui a configuração inicial
    const initModal = document.getElementById('initialSetupModal');
    if (isLayerOpen(initModal) && initModal.contains(activeEl) && (tag === 'INPUT' || tag === 'SELECT')) {
      e.preventDefault();
      const step1Box = document.getElementById('initStep1Box');
      if (step1Box && !step1Box.classList.contains('hidden')) {
        document.getElementById('initNextToStep2Btn')?.click();
      } else {
        document.getElementById('saveInitialSetupBtn')?.click();
      }
      return;
    }
    return;
  }

  if (!hasActiveWorkspace()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (modals.hasOpenModal()) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;

  const key = e.key.toLowerCase();
  if (key === 'n') {
    e.preventDefault();
    modals.openEntryIntentModal();
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

document.getElementById('openProfileBtn')?.addEventListener('click', () => {
  closeUserMenu();
  profile.openProfileModal('perfil');
});
document.getElementById('openShortcutsBtn')?.addEventListener('click', () => closeUserMenu());
document.getElementById('logoutBtn')?.addEventListener('click', () => closeUserMenu());

// ==================== CICLOS E HISTÓRICO ====================
function renderCyclesModal() {
  const { chrono, summary } = computeChronologicalAndFIFO(entries);
  const firstDate = chrono.length > 0 ? chrono[0].date : getLocalDateISO();
  const ruleText = document.getElementById('currentCycleRuleText');
  const periodText = document.getElementById('currentCyclePeriodText');
  const balText = document.getElementById('currentCycleBalanceText');
  if (ruleText) ruleText.textContent = `${getActiveRuleSummary(settings)} (${settings.stateUf || 'SP'})`;
  if (periodText) periodText.textContent = chrono.length > 0
    ? `Desde ${formatDateBR(firstDate)} • ${chrono.length} ${chrono.length === 1 ? 'registro' : 'registros'}`
    : 'Nenhum lançamento no ciclo atual';
  if (balText) {
    balText.textContent = formatVisibleHHMM(summary.realizedMinutes, true);
    balText.className = summary.realizedMinutes < 0
      ? 'font-mono text-base font-extrabold tabular-nums text-rose-600 dark:text-rose-400 shrink-0'
      : 'font-mono text-base font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0';
  }

  const listEl = document.getElementById('archivedCyclesList');
  if (listEl) {
    if (archivedCycles.length === 0) {
      listEl.innerHTML = '<div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-center text-xs text-slate-500 dark:text-slate-400">Nenhum ciclo arquivado ainda.</div>';
    } else {
      listEl.innerHTML = archivedCycles.map((c) => {
        const bal = Number(c.finalBalanceMinutes) || 0;
        const balCls = bal < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';
        return `
          <button type="button" data-cycle-id="${escapeHtml(c.id)}" class="cycle-history-item w-full min-h-[56px] p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 flex items-center justify-between gap-3 text-left transition">
            <div class="min-w-0 flex-1">
              <p class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(c.name)}</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">${escapeHtml(c.ruleSummary || '')} • Encerrado em ${formatDateBR(c.closedAt)}</p>
            </div>
            <div class="shrink-0 text-right">
              <span class="font-mono text-xs sm:text-sm font-extrabold tabular-nums ${balCls}">${formatVisibleHHMM(bal, true)}</span>
              <span class="block text-[10px] text-slate-400">${c.entriesCount || 0} reg.</span>
            </div>
          </button>
        `;
      }).join('');
    }
  }
}

function openCyclesModal() {
  const modal = document.getElementById('cyclesModal');
  if (!modal) return;
  modals.captureLastFocus();
  document.getElementById('newCycleWizard')?.classList.add('hidden');
  renderCyclesModal();
  openAnimatedModal(modal);
  renderLucideIcons(modal);
}

function closeCyclesModal() {
  const modal = document.getElementById('cyclesModal');
  if (!modal || !isLayerOpen(modal)) return;
  closeAnimatedModal(modal);
  modals.restoreLastFocus();
}

function openCycleDetailModal(cycle) {
  const modal = document.getElementById('cycleDetailModal');
  if (!modal || !cycle) return;
  activeDetailCycle = cycle;
  modals.captureLastFocus();
  document.getElementById('cycleDetailTitle').textContent = cycle.name || 'Ciclo Arquivado';
  document.getElementById('cycleDetailSubtitle').textContent = `${cycle.ruleSummary || ''} • ${formatDateBR(cycle.startedAt)} até ${formatDateBR(cycle.closedAt)}`;
  const bal = Number(cycle.finalBalanceMinutes) || 0;
  const balEl = document.getElementById('cycleDetailBalance');
  balEl.textContent = formatVisibleHHMM(bal, true);
  balEl.className = bal < 0
    ? 'font-mono text-lg font-extrabold tabular-nums text-rose-600 dark:text-rose-400'
    : 'font-mono text-lg font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400';
  document.getElementById('cycleDetailCount').textContent = `${cycle.entriesCount || cycle.entries?.length || 0} registros`;

  const listEl = document.getElementById('cycleDetailEntriesList');
  if (listEl) {
    const rows = Array.isArray(cycle.entries) ? cycle.entries : [];
    if (!rows.length) {
      listEl.innerHTML = '<div class="p-6 text-center text-xs text-slate-500 dark:text-slate-400">Sem lançamentos registrados neste ciclo.</div>';
    } else {
      listEl.innerHTML = rows.map((item) => {
        const isCredit = item.type === 'credit';
        const delta = isCredit ? Number(item.minutes) : -Number(item.minutes);
        return `
          <div class="px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-xs font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(item.title)}</p>
              <p class="text-[11px] font-mono text-slate-500 dark:text-slate-400">${formatDateBR(item.date)}</p>
            </div>
            <span class="font-mono text-xs font-bold tabular-nums shrink-0 ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${formatVisibleHHMM(delta, true)}</span>
          </div>
        `;
      }).join('');
    }
  }
  openAnimatedModal(modal);
  renderLucideIcons(modal);
}

function closeCycleDetailModal() {
  const modal = document.getElementById('cycleDetailModal');
  if (!modal || !isLayerOpen(modal)) return;
  closeAnimatedModal(modal);
  activeDetailCycle = null;
  modals.restoreLastFocus();
}

async function handleExecuteCycleRollover(mode) {
  if (!hasActiveWorkspace()) return;
  const activeStorageKey = currentUser?.id || 'guest';
  const { summary } = computeChronologicalAndFIFO(entries);
  const rawName = document.getElementById('newCycleNameInput')?.value.trim() || '';
  const actionTitle = mode === 'carry' ? 'Continuar com minhas horas?' : 'Começar novo ciclo zerado?';
  const actionMsg = mode === 'carry'
    ? `O ciclo "${rawName || 'Atual'}" será arquivado no histórico e o saldo (${formatHHMM(summary.projectedMinutes, true)}) continuará valendo com seus prazos originais.`
    : `O ciclo "${rawName || 'Atual'}" será arquivado no histórico e o novo ciclo começará em 00:00.`;

  const confirmed = await modals.confirmDialog({
    title: actionTitle,
    message: actionMsg,
    confirmText: 'Confirmar virada de ciclo',
    cancelText: 'Voltar',
    variant: 'warning'
  });
  if (!confirmed) return;

  const { archivedCycle, nextEntries } = computeCycleCarryOver(entries, settings, {
    mode,
    cycleName: rawName,
    closingDate: getLocalDateISO()
  });

  const prevEntries = [...entries];
  const prevCycles = [...archivedCycles];
  archivedCycles = [archivedCycle, ...archivedCycles];
  saveArchivedCycles(activeStorageKey, archivedCycles);
  entries = nextEntries;
  persistCurrentUserSnapshot();

  if (isGuestMode && !currentUser) {
    setSyncStatus('local');
    renderAll();
    renderCyclesModal();
    document.getElementById('newCycleWizard')?.classList.add('hidden');
    showToast('Ciclo arquivado neste aparelho!');
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    for (const oldItem of prevEntries) enqueueLocalSync({ kind: 'delete', id: oldItem.id });
    for (const newItem of nextEntries) enqueueLocalSync({ kind: 'upsert', entry: newItem });
    enqueueLocalSync({ kind: 'cycles', cycles: archivedCycles });
    setSyncStatus('offline');
    renderAll();
    renderCyclesModal();
    document.getElementById('newCycleWizard')?.classList.add('hidden');
    showToast('Novo ciclo iniciado no aparelho!');
    return;
  }

  try {
    await deleteAllEntriesFromCloud(currentUser.id, setSyncStatus);
    if (nextEntries.length > 0) {
      await upsertEntriesBatchToCloud(currentUser.id, nextEntries, setSyncStatus);
    }
    const cycleCloudRes = await saveArchivedCyclesToCloud(currentUser.id, archivedCycles, setSyncStatus);
    saveSyncQueue(currentUser.id, []);
    renderAll();
    renderCyclesModal();
    document.getElementById('newCycleWizard')?.classList.add('hidden');
    showToast(cycleCloudRes?.schemaPending
      ? 'Ciclo arquivado neste aparelho (execute o SQL archived_cycles para sincronizar histórico na nuvem).'
      : 'Ciclo arquivado e sincronizado na nuvem!');
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      for (const oldItem of prevEntries) enqueueLocalSync({ kind: 'delete', id: oldItem.id });
      for (const newItem of nextEntries) enqueueLocalSync({ kind: 'upsert', entry: newItem });
      enqueueLocalSync({ kind: 'cycles', cycles: archivedCycles });
      setSyncStatus('offline');
      renderAll();
      renderCyclesModal();
      document.getElementById('newCycleWizard')?.classList.add('hidden');
      showToast('Novo ciclo salvo na fila local!');
      return;
    }
    archivedCycles = prevCycles;
    saveArchivedCycles(currentUser.id, prevCycles);
    entries = prevEntries;
    persistCurrentUserSnapshot();
    renderAll();
    showToast('Erro ao sincronizar virada de ciclo — revertido');
  }
}

modals.registerExternalModal('cyclesModal', closeCyclesModal);
modals.registerExternalModal('cycleDetailModal', closeCycleDetailModal);
document.getElementById('openCyclesBtn')?.addEventListener('click', () => {
  closeUserMenu();
  openCyclesModal();
});
document.getElementById('closeCyclesModalBtn')?.addEventListener('click', closeCyclesModal);
document.getElementById('cyclesModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'cyclesModal') closeCyclesModal();
});
document.getElementById('closeCycleDetailBtn')?.addEventListener('click', closeCycleDetailModal);
document.getElementById('cycleDetailModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'cycleDetailModal') closeCycleDetailModal();
});
document.getElementById('startNewCycleBtn')?.addEventListener('click', () => {
  const wizard = document.getElementById('newCycleWizard');
  const nameInput = document.getElementById('newCycleNameInput');
  const carryBtn = document.getElementById('cycleModeCarryBtn');
  const carryTitle = document.getElementById('cycleModeCarryTitle');
  const { summary } = computeChronologicalAndFIFO(entries);
  const now = new Date();
  const monthShort = now.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const capMonth = monthShort.charAt(0).toUpperCase() + monthShort.slice(1);
  if (nameInput) nameInput.value = `${getActiveRuleSummary(settings)} até ${capMonth}/${now.getFullYear()}`;
  const hasBalance = summary.projectedMinutes !== 0 || summary.realizedMinutes !== 0;
  carryBtn?.classList.toggle('hidden', !hasBalance);
  if (carryTitle) {
    carryTitle.textContent = `Continuar com minhas horas (${formatHHMM(summary.projectedMinutes, true)})`;
  }
  wizard?.classList.toggle('hidden');
});
document.getElementById('cycleModeCarryBtn')?.addEventListener('click', () => handleExecuteCycleRollover('carry'));
document.getElementById('cycleModeZeroBtn')?.addEventListener('click', () => handleExecuteCycleRollover('zero'));
document.getElementById('archivedCyclesList')?.addEventListener('click', (e) => {
  const itemBtn = e.target.closest('[data-cycle-id]');
  if (!itemBtn) return;
  const target = archivedCycles.find((c) => c.id === itemBtn.dataset.cycleId);
  if (target) openCycleDetailModal(target);
});
document.getElementById('cycleDetailPdfBtn')?.addEventListener('click', async () => {
  if (!activeDetailCycle) return;
  const c = activeDetailCycle;
  const snapSettings = { ...settings, ...(c.settingsSnapshot || {}) };
  const rows = Array.isArray(c.entries) ? c.entries : [];
  const { remainingMap } = computeChronologicalAndFIFO(rows, c.closedAt);
  const scopeLabel = `Arquivo: ${c.name} (${formatDateBR(c.startedAt)} a ${formatDateBR(c.closedAt)})`;
  const integrityCode = await computeIntegrityDigest(rows, snapSettings, scopeLabel);
  const opts = { userEmail: currentUser?.email, scopeLabel, globalChrono: rows, remainingMap, integrityCode };
  try {
    await ensureJsPdf().catch((loadErr) => {
      throw Object.assign(new Error(loadErr?.message || 'jsPDF indisponível'), { code: 'JSPDF_UNAVAILABLE' });
    });
    exportPDF(rows, snapSettings, opts);
    showToast('PDF do ciclo arquivado baixado!');
  } catch (err) {
    if (err?.code === 'JSPDF_UNAVAILABLE') exportModal.triggerNativePrint(rows, opts);
    else showToast(err.message || 'Erro ao gerar PDF do ciclo');
  }
});
document.getElementById('cycleDetailExcelBtn')?.addEventListener('click', () => {
  if (!activeDetailCycle) return;
  const c = activeDetailCycle;
  const snapSettings = { ...settings, ...(c.settingsSnapshot || {}) };
  const rows = Array.isArray(c.entries) ? c.entries : [];
  const { remainingMap } = computeChronologicalAndFIFO(rows, c.closedAt);
  exportExcelXML(rows, remainingMap, snapSettings, {
    userEmail: currentUser?.email,
    scopeLabel: `Arquivo: ${c.name}`,
    globalChrono: rows
  });
  showToast('Excel do ciclo arquivado baixado!');
});

function syncGuestModeUI() {
  const isGuest = isGuestMode && !currentUser;
  const hasDemo = entries.some((e) => Boolean(e.isDemo));

  document.getElementById('guestActivateCloudBtn')?.classList.toggle('hidden', !isGuest);
  document.getElementById('guestResetToAuthBtn')?.classList.toggle('hidden', !isGuest);
  document.getElementById('userMenuProfileGroup')?.classList.toggle('hidden', isGuest);
  document.getElementById('logoutBtn')?.classList.toggle('hidden', isGuest);
  document.getElementById('loadDemoExamplesBtn')?.classList.toggle('hidden', !isGuest);
  document.getElementById('demoModeBanner')?.classList.toggle('hidden', !(isGuest && hasDemo));

  const guestBanner = document.getElementById('guestLocalBanner');
  if (guestBanner) {
    guestBanner.classList.toggle('hidden', !isGuest || isGuestBannerDismissed());
  }

  if (isGuest) {
    const avatarEl = document.getElementById('headerProfileAvatar');
    const labelEl = document.getElementById('headerProfileLabel');
    const menuFullName = document.getElementById('userMenuFullName');
    const menuSubInfo = document.getElementById('userMenuSubInfo');
    if (avatarEl) avatarEl.textContent = 'LC';
    if (labelEl) labelEl.textContent = 'Local';
    if (menuFullName) menuFullName.textContent = 'Modo Teste Local';
    if (menuSubInfo) menuSubInfo.textContent = 'Salvo apenas neste aparelho';
  }
}

function consumePendingUrlShortcut() {
  if (!pendingUrlShortcut) return false;
  const target = pendingUrlShortcut;
  pendingUrlShortcut = null;
  if (target === 'ganho') {
    modals.openEntryModal({ type: 'credit' }, false, { source: 'intent' });
    return true;
  }
  if (target === 'folga') {
    modals.openEntryModal({ type: 'debit', category: 'time_off' }, false, { source: 'intent' });
    return true;
  }
  return false;
}

function syncAuthPresetNoticeUI({ mode = 'login' } = {}) {
  const noticeEl = document.getElementById('authPresetNotice');
  if (!noticeEl) return;
  const pendingPreset = loadPendingRulePreset();
  const shouldShow = Boolean(pendingPreset?.label && (mode === 'login' || mode === 'signup'));
  noticeEl.classList.toggle('hidden', !shouldShow);
  if (shouldShow) {
    noticeEl.textContent = `Regra escolhida no simulador: ${pendingPreset.label} — ficará pré-selecionada ao iniciar seu acesso.`;
  }
}

function consumePendingSimulatorEntry() {
  if (!pendingSimulatorEntry || !pendingSimulatorEntry.minutes) return false;
  const sim = pendingSimulatorEntry;
  pendingSimulatorEntry = null;
  modals.openEntryModal(
    { type: 'credit', category: sim.category || 'holiday', minutes: sim.minutes },
    false,
    { source: 'intent' }
  );
  return true;
}

function enterGuestMode() {
  currentUser = null;
  isGuestMode = true;
  setGuestModeActive(true);
  const hasExistingGuest = (() => {
    try {
      return Boolean(localStorage.getItem(STORAGE_KEYS.GUEST_STATE));
    } catch {
      return false;
    }
  })();
  const saved = loadGuestState();
  settings = saved.settings;
  entries = saved.entries;
  const pendingPreset = loadPendingRulePreset();
  if (!hasExistingGuest && pendingPreset) {
    const u = pendingPreset?.unionCode ? findUnionByCode(pendingPreset.unionCode) : null;
    if (u) {
      settings = {
        ...settings,
        unionMode: 'union',
        unionCode: u.code,
        companySector: u.sector || settings.companySector,
        dailyMinutes: u.dailyMinutes,
        overtimeMultiplier: u.overtimeMultiplier,
        holidayMultiplier: u.holidayMultiplier,
        expiryDays: u.expiryDays,
        stateUf: u.stateUf || settings.stateUf
      };
      saveGuestState({ settings, entries });
    }
  }
  clearPendingRulePreset();
  archivedCycles = loadArchivedCycles('guest');
  try {
    if (settings.stateUf) localStorage.setItem(STORAGE_KEYS.HOLIDAY_UF, settings.stateUf);
  } catch { /* ignore */ }
  syncGuestModeUI();
  updateHeaderUserInfo();
  setSyncStatus('local');
  renderAll();
  authController?.revealLoadingOverlay?.();
  if (!consumePendingUrlShortcut() && pendingSimulatorEntry && entries.length === 0 && !modals.hasOpenModal()) {
    consumePendingSimulatorEntry();
  }
}

let pendingMigrationState = null;
function closeGuestMigrationModal() {
  const modal = document.getElementById('guestMigrationModal');
  if (!modal || !isLayerOpen(modal)) return;
  closeAnimatedModal(modal);
  pendingMigrationState = null;
  modals.restoreLastFocus();
}

function openGuestMigrationModal(plan, user, guestState, cloudData) {
  const modal = document.getElementById('guestMigrationModal');
  if (!modal) return;
  pendingMigrationState = { plan, user, guestState, cloudData };
  const titleEl = document.getElementById('guestMigrationTitle');
  const bodyEl = document.getElementById('guestMigrationBody');
  const primaryBtn = document.getElementById('guestMigrationPrimaryBtn');
  const secondaryBtn = document.getElementById('guestMigrationSecondaryBtn');

  const count = plan.realEntries.length;
  const countLabel = `${count} ${count === 1 ? 'lançamento salvo' : 'lançamentos salvos'}`;
  const balFormatted = formatHHMM(plan.balanceMinutes, true);

  if (plan.action === 'merge_prompt') {
    if (titleEl) titleEl.textContent = 'Sua conta já tem dados na nuvem';
    if (bodyEl) {
      bodyEl.innerHTML = `Encontramos <strong>${escapeHtml(countLabel)}</strong> no modo teste (Saldo: <strong class="font-mono">${escapeHtml(balFormatted)}</strong>) e <strong>${plan.cloudCount}</strong> na sua conta. Como deseja continuar?`;
    }
    if (primaryBtn) primaryBtn.textContent = 'Mesclar com minha conta';
    if (secondaryBtn) secondaryBtn.textContent = 'Usar só os dados da nuvem';
  } else {
    if (titleEl) titleEl.textContent = 'Trazer seus dados para a nuvem?';
    if (bodyEl) {
      bodyEl.innerHTML = `Encontramos <strong>${escapeHtml(countLabel)}</strong> neste aparelho (Saldo: <strong class="font-mono">${escapeHtml(balFormatted)}</strong>). Deseja importar para sua nova conta?`;
    }
    if (primaryBtn) primaryBtn.textContent = 'Importar meus dados';
    if (secondaryBtn) secondaryBtn.textContent = 'Começar zerado';
  }

  modals.captureLastFocus();
  openAnimatedModal(modal);
  renderLucideIcons(modal);
}

modals.registerExternalModal('guestMigrationModal', closeGuestMigrationModal);

document.getElementById('guestMigrationPrimaryBtn')?.addEventListener('click', async () => {
  if (!pendingMigrationState) return;
  const { plan, user, guestState, cloudData } = pendingMigrationState;
  const primaryBtn = document.getElementById('guestMigrationPrimaryBtn');
  if (primaryBtn) primaryBtn.disabled = true;

  try {
    const toInsert = plan.action === 'merge_prompt'
      ? mergeGuestWithCloudEntries(cloudData.entries, plan.realEntries)
      : plan.realEntries.map(({ isDemo: _drop, ...clean }) => clean);

    if (plan.action === 'new_account_prompt' && guestState?.settings) {
      settings = { ...cloudData.settings, ...guestState.settings, userName: settings.userName || guestState.settings.userName };
      await saveSettingsToCloud(user.id, settings, setSyncStatus);
    }
    if (toInsert.length > 0) {
      await upsertEntriesBatchToCloud(user.id, toInsert, setSyncStatus);
      entries = [...entries, ...toInsert];
    }
    clearGuestState();
    isGuestMode = false;
    syncGuestModeUI();
    persistCurrentUserSnapshot();
    updateHeaderUserInfo();
    renderAll();
    closeGuestMigrationModal();
    showToast('Dados importados com sucesso');
  } catch {
    showToast('Erro ao importar dados para a nuvem. Tente novamente.');
  } finally {
    if (primaryBtn) primaryBtn.disabled = false;
  }
});

document.getElementById('guestMigrationSecondaryBtn')?.addEventListener('click', () => {
  clearGuestState();
  isGuestMode = false;
  syncGuestModeUI();
  closeGuestMigrationModal();
  showToast('Dados de teste descartados');
});

document.getElementById('guestActivateCloudBtn')?.addEventListener('click', () => {
  closeUserMenu();
  authController?.openAuthModal('signup');
});
document.getElementById('guestBannerCtaBtn')?.addEventListener('click', () => {
  authController?.openAuthModal('signup');
});
document.getElementById('dismissGuestBannerBtn')?.addEventListener('click', () => {
  setGuestBannerDismissed(true);
  document.getElementById('guestLocalBanner')?.classList.add('hidden');
});
document.getElementById('guestResetToAuthBtn')?.addEventListener('click', () => {
  closeUserMenu();
  isGuestMode = false;
  setGuestModeActive(false);
  authController?.openAuthModal('login');
});
document.getElementById('loadDemoExamplesBtn')?.addEventListener('click', () => {
  if (!isGuestMode) return;
  entries = createDemoEntries(settings);
  persistCurrentUserSnapshot();
  syncGuestModeUI();
  renderAll();
  showToast('Exemplos carregados!');
});
document.getElementById('clearDemoExamplesBtn')?.addEventListener('click', () => {
  entries = entries.filter((e) => !e.isDemo);
  persistCurrentUserSnapshot();
  syncGuestModeUI();
  renderAll();
  showToast('Exemplos removidos!');
});

authController = setupAuth({
  onToast: showToast,
  initialMode: pendingAuthMode,
  onAuthModalOpen: (info) => syncAuthPresetNoticeUI(info),
  shouldRestoreGuest: () => isGuestModeActive(),
  onEnterGuestMode: () => enterGuestMode(),
  onUserUpdated(user) {
    currentUser = user;
    updateHeaderUserInfo();
    profile.syncProfileHeaderSummary();
  },
  async onBeforeLogout() {
    if (!currentUser?.id) return true;
    const pendingQueue = loadSyncQueue(currentUser.id);
    if (!pendingQueue.length) return true;
    return modals.confirmDialog({
      title: 'Alterações ainda não enviadas',
      message: formatPendingLogoutWarning(pendingQueue.length),
      confirmText: 'Sair mesmo assim',
      cancelText: 'Cancelar',
      variant: 'danger'
    });
  },
  async onSignedOut({ clearStorage = true } = {}) {
    if (clearStorage) {
      clearPendingRulePreset();
      await clearClientUserStorage();
    }
    currentUser = null;
    isGuestMode = false;
    privacyMode = false;
    settings = createDefaultSettings();
    entries = [];
    archivedCycles = [];
    activeDetailCycle = null;
    pendingMigrationState = null;
    quickFilter = 'all';
    sortAscending = true;
    entriesVisibleLimit = ENTRIES_PAGE_SIZE;
    lastRenderedRealizedMinutes = null;
    isFlushingQueue = false;
    syncAlertDismissedState = null;
    defaultTemplatesCache = { emailTemplate: '', whatsappTemplate: '' };
    renderedChronoById = new Map();
    renderedRemainingMap = new Map();
    activeDetailEntryId = null;

    const searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
    profile.resetForSignOut();
    modals.closeAllModals();
    destroyCharts();
    closeUserMenu();
    closeExportMenu();
    syncPrivacyButtonsUI();
    syncGuestModeUI();
    updateHeaderUserInfo();
    setSyncStatus('ok');
    renderAll();

    const avatarEl = document.getElementById('headerProfileAvatar');
    const labelEl = document.getElementById('headerProfileLabel');
    const menuFullName = document.getElementById('userMenuFullName');
    const menuSubInfo = document.getElementById('userMenuSubInfo');
    if (avatarEl) avatarEl.textContent = 'SH';
    if (labelEl) labelEl.textContent = 'Perfil';
    if (menuFullName) menuFullName.textContent = 'Minha Conta';
    if (menuSubInfo) menuSubInfo.textContent = 'Backup automático na nuvem';
  },
  async onSessionReady(user, meta = {}) {
    currentUser = user;
    const wasGuest = isGuestMode || isGuestModeActive();
    const guestStateSnapshot = wasGuest ? loadGuestState() : null;
    isGuestMode = false;
    setSyncStatus('saving');
    let loadedSuccessfully = false;
    let cloudDataForMigration = null;
    try {
      const data = await loadUserDataFromCloud(user);
      cloudDataForMigration = data;
      const pendingQueue = loadSyncQueue(user.id);
      const merged = pendingQueue.length > 0
        ? applyQueueToState({ settings: data.settings, entries: data.entries }, pendingQueue)
        : data;
      settings = merged.settings;
      entries = merged.entries;
      const localCycles = loadArchivedCycles(user.id);
      const cloudCycles = Array.isArray(data.archivedCycles) ? data.archivedCycles : [];
      archivedCycles = mergeArchivedCycles(localCycles, cloudCycles);
      saveArchivedCycles(user.id, archivedCycles);
      if (archivedCycles.length > cloudCycles.length && navigator.onLine !== false) {
        void saveArchivedCyclesToCloud(user.id, archivedCycles).catch(() => null);
      }
      persistCurrentUserSnapshot();
      try {
        if (settings.stateUf) localStorage.setItem(STORAGE_KEYS.HOLIDAY_UF, settings.stateUf);
      } catch { /* ignore */ }
      syncGuestModeUI();
      updateHeaderUserInfo();
      renderAll();
      loadedSuccessfully = true;

      if (pendingQueue.length > 0 && navigator.onLine !== false) {
        await flushPendingSyncQueue({ showSyncedToast: true });
      } else {
        setSyncStatus('ok');
      }
    } catch (err) {
      const cached = loadUserCache(user.id);
      if (cached) {
        const merged = applyQueueToState(cached, loadSyncQueue(user.id));
        if (merged.settings) settings = merged.settings;
        if (Array.isArray(merged.entries)) entries = merged.entries;
        archivedCycles = loadArchivedCycles(user.id);
        try {
          if (settings.stateUf) localStorage.setItem(STORAGE_KEYS.HOLIDAY_UF, settings.stateUf);
        } catch { /* ignore */ }
        syncGuestModeUI();
        updateHeaderUserInfo();
        setSyncStatus(navigator.onLine === false ? 'offline' : 'pending');
        renderAll();
        loadedSuccessfully = true;
        showToast('Modo offline — exibindo os dados salvos neste aparelho.');
      } else {
        console.error('Erro ao carregar dados da nuvem:', err);
        setSyncStatus('error');
        showToast('Erro ao sincronizar seus dados');
      }
    } finally {
      authController?.revealLoadingOverlay?.();
      if (wasGuest && guestStateSnapshot && cloudDataForMigration) {
        const plan = computeGuestMigrationPlan({
          guestEntries: guestStateSnapshot.entries,
          cloudEntries: cloudDataForMigration.entries,
          isNewAccount: meta?.event === 'SIGNED_IN' && cloudDataForMigration.entries.length === 0
        });
        if (plan.action === 'silent') {
          clearGuestState();
        } else {
          openGuestMigrationModal(plan, user, guestStateSnapshot, cloudDataForMigration);
        }
      } else if (loadedSuccessfully) {
        const openedShortcut = consumePendingUrlShortcut();
        if (!openedShortcut && entries.length === 0 && !hasCompletedOnboarding(user.id) && !modals.hasOpenModal()) {
          modals.openInitialSetupModal({ startStep: 1, adjustOnly: false });
        }
      }
    }
  }
});

// ==================== INSTALAÇÃO PWA & STATUS DE REDE ====================
let deferredInstallPrompt = null;
const installAppMenuBtn = document.getElementById('installAppMenuBtn');
const iosInstallModal = document.getElementById('iosInstallModal');

function isStandaloneApp() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator?.standalone === true
  );
}

function syncInstallAppMenuVisibility() {
  if (!installAppMenuBtn) return;
  installAppMenuBtn.classList.toggle('hidden', isStandaloneApp());
}

function openIosInstallModal() {
  if (!iosInstallModal) return;
  modals.captureLastFocus();
  openAnimatedModal(iosInstallModal);
  renderLucideIcons(iosInstallModal);
}

function closeIosInstallModal() {
  if (!iosInstallModal || !isLayerOpen(iosInstallModal)) return;
  closeAnimatedModal(iosInstallModal);
  modals.restoreLastFocus();
}

modals.registerExternalModal('iosInstallModal', closeIosInstallModal);
document.getElementById('closeIosInstallBtn')?.addEventListener('click', closeIosInstallModal);
document.getElementById('confirmIosInstallBtn')?.addEventListener('click', closeIosInstallModal);
iosInstallModal?.addEventListener('click', (e) => {
  if (e.target.id === 'iosInstallModal') closeIosInstallModal();
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  syncInstallAppMenuVisibility();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  syncInstallAppMenuVisibility();
  showToast('SaldoHoras instalado com sucesso!');
});

installAppMenuBtn?.addEventListener('click', async () => {
  closeUserMenu();
  if (isStandaloneApp()) {
    syncInstallAppMenuVisibility();
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      showToast('SaldoHoras instalado com sucesso!');
    }
    deferredInstallPrompt = null;
    syncInstallAppMenuVisibility();
    return;
  }
  openIosInstallModal();
});

syncInstallAppMenuVisibility();

window.addEventListener('online', async () => {
  const synced = await flushPendingSyncQueue({ showSyncedToast: true });
  if (synced === 0) {
    const hasPending = currentUser?.id ? loadSyncQueue(currentUser.id).length > 0 : false;
    setSyncStatus(hasPending ? 'pending' : 'ok');
    if (!hasPending) showToast('Conexão restabelecida — nuvem sincronizada');
  }
});

window.addEventListener('offline', () => {
  setSyncStatus('offline');
  showToast('Você está offline — dados salvos localmente');
});

if (typeof navigator !== 'undefined' && navigator.onLine === false) {
  setSyncStatus('offline');
}

// Registro e atualizações controladas do Service Worker PWA com caminho relativo
const checkUpdatesMenuBtn = document.getElementById('checkUpdatesMenuBtn');
if (checkUpdatesMenuBtn) {
  checkUpdatesMenuBtn.textContent = `SaldoHoras v${APP_VERSION} • Verificar atualizações`;
}

const swUpdater = initServiceWorkerUpdates({
  onToast: showToast,
  swUrl: './sw.js',
  scope: './',
  version: APP_VERSION
});

checkUpdatesMenuBtn?.addEventListener('click', async () => {
  closeUserMenu();
  await swUpdater.checkForUpdatesManual();
});

// ==================== AJUDA RÁPIDA, FEEDBACK E COMPARTILHAR ====================
const helpFeedbackModal = document.getElementById('helpFeedbackModal');
let lastFeedbackFallbackText = '';

function setFeedbackType(typeVal) {
  const next = typeVal === 'problema' ? 'problema' : 'sugestao';
  const hidden = document.getElementById('feedbackTypeValue');
  if (hidden) hidden.value = next;
  const activeCls = 'sh-touch-h44 px-3 py-2 rounded-xl border border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200 text-xs font-semibold transition';
  const inactiveCls = 'sh-touch-h44 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition';
  const sugBtn = document.getElementById('feedbackTypeSugestaoBtn');
  const probBtn = document.getElementById('feedbackTypeProblemaBtn');
  if (sugBtn) {
    sugBtn.className = next === 'sugestao' ? activeCls : inactiveCls;
    sugBtn.setAttribute('aria-checked', String(next === 'sugestao'));
  }
  if (probBtn) {
    probBtn.className = next === 'problema' ? activeCls : inactiveCls;
    probBtn.setAttribute('aria-checked', String(next === 'problema'));
  }
}

function showFeedbackAlert(msg, tone = 'success') {
  const el = document.getElementById('feedbackAlert');
  if (!el) return;
  el.classList.remove(
    'hidden',
    'bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 'dark:bg-emerald-950/60', 'dark:text-emerald-200', 'dark:border-emerald-800',
    'bg-rose-50', 'text-rose-800', 'border-rose-200', 'dark:bg-rose-950/60', 'dark:text-rose-200', 'dark:border-rose-800'
  );
  if (tone === 'error') {
    el.classList.add('bg-rose-50', 'text-rose-800', 'border-rose-200', 'dark:bg-rose-950/60', 'dark:text-rose-200', 'dark:border-rose-800');
  } else {
    el.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 'dark:bg-emerald-950/60', 'dark:text-emerald-200', 'dark:border-emerald-800');
  }
  el.textContent = msg;
}

function openHelpFeedbackModal() {
  if (!helpFeedbackModal) return;
  modals.captureLastFocus();
  clearAllInlineErrors(helpFeedbackModal);
  document.getElementById('feedbackAlert')?.classList.add('hidden');
  document.getElementById('feedbackOfflineFallback')?.classList.add('hidden');
  setFeedbackType(document.getElementById('feedbackTypeValue')?.value || 'sugestao');
  openAnimatedModal(helpFeedbackModal);
  renderLucideIcons(helpFeedbackModal);
}

function closeHelpFeedbackModal() {
  if (!helpFeedbackModal || !isLayerOpen(helpFeedbackModal)) return;
  closeAnimatedModal(helpFeedbackModal);
  modals.restoreLastFocus();
}

modals.registerExternalModal('helpFeedbackModal', closeHelpFeedbackModal);
document.getElementById('openHelpFeedbackBtn')?.addEventListener('click', () => {
  closeUserMenu();
  openHelpFeedbackModal();
});
document.getElementById('closeHelpFeedbackBtn')?.addEventListener('click', closeHelpFeedbackModal);
helpFeedbackModal?.addEventListener('click', (e) => {
  if (e.target.id === 'helpFeedbackModal') closeHelpFeedbackModal();
});
document.getElementById('feedbackTypeSugestaoBtn')?.addEventListener('click', () => setFeedbackType('sugestao'));
document.getElementById('feedbackTypeProblemaBtn')?.addEventListener('click', () => setFeedbackType('problema'));

async function copyTextToClipboardSafe(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback */ }
  try {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.setAttribute('readonly', 'readonly');
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(tmp);
    return Boolean(ok);
  } catch {
    return false;
  }
}

document.getElementById('feedbackForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgInput = document.getElementById('feedbackMessageInput');
  const msgWrap = document.getElementById('feedbackMessageWrap');
  const submitBtn = document.getElementById('feedbackSubmitBtn');
  const fallbackBox = document.getElementById('feedbackOfflineFallback');
  clearAllInlineErrors(helpFeedbackModal);
  document.getElementById('feedbackAlert')?.classList.add('hidden');
  fallbackBox?.classList.add('hidden');

  const rawMsg = msgInput?.value.trim() || '';
  if (rawMsg.length < 5) {
    triggerInlineFieldError(msgWrap, msgInput, 'Escreva pelo menos 5 caracteres para enviar seu feedback.');
    return;
  }

  const feedbackType = document.getElementById('feedbackTypeValue')?.value === 'problema' ? 'problema' : 'sugestao';
  const platform = typeof window !== 'undefined' && window.innerWidth < 1024 ? 'mobile' : 'desktop';
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('OFFLINE');
    }
    await submitFeedbackToCloud({
      userId: currentUser?.id || null,
      type: feedbackType,
      message: rawMsg,
      appVersion: APP_VERSION,
      platform
    });
    if (msgInput) msgInput.value = '';
    showFeedbackAlert('Obrigado! Seu feedback foi enviado.', 'success');
    showToast('Obrigado! Seu feedback foi enviado.');
  } catch {
    const typeLabel = feedbackType === 'problema' ? 'Relato de problema' : 'Sugestão';
    lastFeedbackFallbackText = `[${typeLabel}] SaldoHoras v${APP_VERSION} (${platform})\n${rawMsg}`;
    await copyTextToClipboardSafe(lastFeedbackFallbackText);
    const mailLink = document.getElementById('feedbackMailFallbackLink');
    if (mailLink) {
      mailLink.href = `mailto:?subject=${encodeURIComponent(`Feedback SaldoHoras (${typeLabel})`)}&body=${encodeURIComponent(lastFeedbackFallbackText)}`;
    }
    fallbackBox?.classList.remove('hidden');
    showToast('Sem conexão — mensagem copiada para envio alternativo');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

document.getElementById('feedbackCopyFallbackBtn')?.addEventListener('click', async () => {
  if (!lastFeedbackFallbackText) return;
  const ok = await copyTextToClipboardSafe(lastFeedbackFallbackText);
  showToast(ok ? 'Mensagem copiada!' : 'Não foi possível copiar automaticamente');
});

document.getElementById('shareAppMenuBtn')?.addEventListener('click', async () => {
  closeUserMenu();
  const sharePayload = {
    title: 'SaldoHoras',
    text: 'Acompanhe seu banco de horas, folgas e prazos no celular ou computador.',
    url: APP_PUBLIC_URL
  };
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(sharePayload);
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const copied = await copyTextToClipboardSafe(APP_PUBLIC_URL);
  showToast(copied ? 'Link copiado para compartilhar' : APP_PUBLIC_URL);
});

initTheme();
syncPrivacyButtonsUI();
syncSearchPlaceholder();
initAccordions(document);
initSlidingTabsGroup(
  document.getElementById('mainTabsBar'),
  '.main-tab-btn',
  (bar) => bar.querySelector(`[data-main-tab="${activeMainTab}"]`),
  { animate: false }
);
initSlidingTabsGroup(
  document.getElementById('analyticsSubTabs'),
  '[data-analytics-subtab]',
  (bar) => bar.querySelector(`[data-analytics-subtab="${activeAnalyticsSubTab}"]`),
  { animate: false }
);
initSlidingTabsGroup(
  document.getElementById('commChannelTabs'),
  '[data-comm-channel]',
  (bar) => bar.querySelector('[aria-selected="true"]'),
  { animate: false }
);
window.addEventListener('resize', () => {
  syncSearchPlaceholder();
  syncMobileFilterIndicators();
});
renderLucideIcons();
