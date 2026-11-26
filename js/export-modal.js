import {
  buildCalendarEventsFromEntries,
  computeExportSummary,
  computeIntegrityDigest,
  downloadIcsEvents,
  exportCSV,
  exportExcelXLSX,
  exportJSONBackup,
  exportPDF,
  exportStructuredXML,
  renderPrintReportSheet
} from './export.js';
import { formatHHMM } from './time.js';
import { closeAnimatedModal, openAnimatedModal, renderLucideIcons } from './ui-motion.js';
import { ensureJsPdf } from './vendor-loader.js';

export function createExportModalManager(ctx) {
  const modal = document.getElementById('exportModal');
  const customBox = document.getElementById('exportCustomDatesBox');
  const dateFromEl = document.getElementById('exportDateFrom');
  const dateToEl = document.getElementById('exportDateTo');
  const customRealizedOnlyEl = document.getElementById('exportCustomRealizedOnly');
  const scopeGridEl = document.getElementById('exportScopeGrid');
  const screenScopeLabelEl = document.getElementById('exportScopeScreenLabel');
  const customScopeLabelEl = document.getElementById('exportScopeCustomLabel');

  function getActiveScope() {
    return document.querySelector('input[name="exportScope"]:checked')?.value || 'all';
  }

  function syncScopeOptionsVisibility(hasActiveFilters) {
    if (screenScopeLabelEl) {
      screenScopeLabelEl.classList.toggle('hidden', !hasActiveFilters);
    }
    if (scopeGridEl) {
      scopeGridEl.classList.toggle('sm:grid-cols-4', Boolean(hasActiveFilters));
      scopeGridEl.classList.toggle('sm:grid-cols-3', !hasActiveFilters);
    }
    if (customScopeLabelEl) {
      customScopeLabelEl.classList.toggle('col-span-2', !hasActiveFilters);
      customScopeLabelEl.classList.toggle('sm:col-span-1', !hasActiveFilters);
    }
    if (!hasActiveFilters && getActiveScope() === 'screen') {
      const allRadio = document.querySelector('input[name="exportScope"][value="all"]');
      if (allRadio) allRadio.checked = true;
    }
  }

  function resolveScopedData() {
    const { chrono, remainingMap, filtered, hasActiveFilters } = ctx.getExportContext();
    const scope = getActiveScope();
    let rows = chrono;
    let scopeLabel = `Extrato completo (${chrono.length} registros)`;

    if (scope === 'screen') {
      rows = filtered;
      scopeLabel = hasActiveFilters
        ? `Filtros ativos da tela (${rows.length} de ${chrono.length} registros)`
        : `Extrato completo (${rows.length} registros)`;
    } else if (scope === 'realized') {
      rows = chrono.filter((e) => e.status === 'realized');
      scopeLabel = `Somente Realizados p/ RH (${rows.length} de ${chrono.length} registros)`;
    } else if (scope === 'custom') {
      const from = dateFromEl?.value || '';
      const to = dateToEl?.value || '';
      const onlyRealized = Boolean(customRealizedOnlyEl?.checked);
      rows = chrono.filter((e) => {
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        if (onlyRealized && e.status !== 'realized') return false;
        return true;
      });
      const rangeNote = from || to ? `${from || 'início'} até ${to || 'hoje'}` : 'todo o período';
      scopeLabel = `Período ${rangeNote}${onlyRealized ? ' (só realizados)' : ''} (${rows.length} de ${chrono.length})`;
    }

    return { chrono, remainingMap, rows, scopeLabel, hasActiveFilters };
  }

  function refreshExportPreview() {
    const scope = getActiveScope();
    customBox?.classList.toggle('hidden', scope !== 'custom');

    const { chrono, rows, hasActiveFilters } = resolveScopedData();
    syncScopeOptionsVisibility(hasActiveFilters);

    const recSum = computeExportSummary(rows);
    const globSum = computeExportSummary(chrono);
    const balancesDiffer = recSum.projectedMinutes !== globSum.projectedMinutes;

    const countEl = document.getElementById('exportPreviewCount');
    const balancesRowEl = document.getElementById('exportPreviewBalancesRow');
    const recSaldoEl = document.getElementById('exportPreviewRecorteSaldo');
    const globSaldoEl = document.getElementById('exportPreviewGlobalSaldo');

    if (countEl) {
      if (!rows.length) {
        countEl.textContent = '0 registros encontrados neste recorte';
      } else {
        const countText = rows.length === chrono.length
          ? `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`
          : `${rows.length} de ${chrono.length} registros`;
        const breakdown = `${recSum.creditsCount} ${recSum.creditsCount === 1 ? 'crédito' : 'créditos'} • ${recSum.debitsCount} ${recSum.debitsCount === 1 ? 'folga' : 'folgas'}`;
        countEl.textContent = balancesDiffer
          ? `${countText} (${breakdown})`
          : `${countText} (${breakdown}) • Saldo: ${formatHHMM(recSum.projectedMinutes, true)}`;
      }
    }

    balancesRowEl?.classList.toggle('hidden', !balancesDiffer);
    if (recSaldoEl) recSaldoEl.textContent = formatHHMM(recSum.projectedMinutes, true);
    if (globSaldoEl) globSaldoEl.textContent = formatHHMM(globSum.projectedMinutes, true);
  }

  function openExportModal() {
    ctx.captureLastFocus();
    const { hasActiveFilters } = ctx.getExportContext();
    syncScopeOptionsVisibility(hasActiveFilters);
    const preferredScope = hasActiveFilters ? 'screen' : 'all';
    const radio = document.querySelector(`input[name="exportScope"][value="${preferredScope}"]`);
    if (radio) radio.checked = true;

    refreshExportPreview();
    openAnimatedModal(modal);
    renderLucideIcons(modal);
    document.getElementById('closeExportModalBtn')?.focus();
  }

  function closeExportModal() {
    closeAnimatedModal(modal);
    ctx.restoreLastFocus();
  }

  ctx.registerExternalModal('exportModal', closeExportModal);

  document.getElementById('closeExportModalBtn')?.addEventListener('click', closeExportModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeExportModal();
  });

  document.querySelectorAll('input[name="exportScope"]').forEach((el) => {
    el.addEventListener('change', refreshExportPreview);
  });
  [dateFromEl, dateToEl, customRealizedOnlyEl].forEach((el) => {
    el?.addEventListener('input', refreshExportPreview);
    el?.addEventListener('change', refreshExportPreview);
  });

  async function buildExportOptions({ chrono, remainingMap, rows, scopeLabel }) {
    const settings = ctx.getSettings();
    const userEmail = ctx.getUserEmail();
    const integrityCode = await computeIntegrityDigest(rows, settings, scopeLabel);
    return {
      userEmail,
      scopeLabel,
      globalChrono: chrono,
      remainingMap,
      includeFifo: Boolean(document.getElementById('exportOptIncludeFifo')?.checked),
      includeSignatures: Boolean(document.getElementById('exportOptIncludeSignatures')?.checked),
      orientation: document.getElementById('exportOptOrientation')?.value || 'landscape',
      integrityCode
    };
  }

  function triggerNativePrint(rows, opts) {
    const sheet = document.getElementById('printReportSheet');
    if (!sheet) return;
    renderPrintReportSheet(sheet, rows, ctx.getSettings(), opts);
    closeExportModal();
    setTimeout(() => window.print(), 80);
  }

  document.getElementById('modalDownloadPdfBtn')?.addEventListener('click', async () => {
    const data = resolveScopedData();
    if (!data.rows.length) {
      ctx.showToast('Nenhum lançamento encontrado no recorte selecionado para exportar PDF.');
      return;
    }
    const opts = await buildExportOptions(data);
    try {
      await ensureJsPdf();
      exportPDF(data.rows, ctx.getSettings(), opts);
      ctx.showToast('Relatório PDF baixado!');
    } catch (err) {
      if (err?.code === 'JSPDF_UNAVAILABLE' || String(err?.message || '').includes('Falha ao carregar')) {
        ctx.showToast('PDF offline indisponível — abrindo impressão...');
        triggerNativePrint(data.rows, opts);
      } else {
        ctx.showToast(err.message || 'Erro ao gerar PDF');
      }
    }
  });

  document.getElementById('modalPrintReportBtn')?.addEventListener('click', async () => {
    const data = resolveScopedData();
    if (!data.rows.length) {
      ctx.showToast('Nenhum lançamento encontrado no recorte para imprimir.');
      return;
    }
    const opts = await buildExportOptions(data);
    triggerNativePrint(data.rows, opts);
  });

  document.getElementById('modalDownloadStructuredXmlBtn')?.addEventListener('click', async () => {
    const data = resolveScopedData();
    const opts = await buildExportOptions(data);
    try {
      exportStructuredXML(data.rows, data.remainingMap, ctx.getSettings(), opts);
      ctx.showToast('Arquivo XML para RH baixado!');
    } catch (err) {
      ctx.showToast(err.message || 'Erro ao gerar XML');
    }
  });

  document.getElementById('modalDownloadExcelXmlBtn')?.addEventListener('click', async () => {
    const data = resolveScopedData();
    const opts = await buildExportOptions(data);
    try {
      exportExcelXLSX(data.rows, data.remainingMap, ctx.getSettings(), opts);
      ctx.showToast('Planilha Excel (.xlsx) baixada!');
    } catch (err) {
      ctx.showToast(err.message || 'Erro ao gerar planilha Excel');
    }
  });

  document.getElementById('modalDownloadCsvBtn')?.addEventListener('click', () => {
    const data = resolveScopedData();
    try {
      exportCSV(data.rows, { includeSummary: true });
      ctx.showToast('Planilha CSV baixada!');
    } catch (err) {
      ctx.showToast(err.message || 'Erro ao exportar CSV');
    }
  });

  document.getElementById('modalDownloadIcsBtn')?.addEventListener('click', () => {
    const data = resolveScopedData();
    try {
      const events = buildCalendarEventsFromEntries(data.rows, data.remainingMap, ctx.getSettings());
      downloadIcsEvents(events);
      ctx.showToast(`${events.length} eventos exportados para Agenda (.ics)!`);
    } catch (err) {
      ctx.showToast(err.message || 'Nenhum evento agendado ou vencimento para agenda.');
    }
  });

  document.getElementById('modalDownloadJsonBtn')?.addEventListener('click', async () => {
    const { chrono } = ctx.getExportContext();
    const code = await computeIntegrityDigest(chrono, ctx.getSettings(), 'Backup Completo do Aplicativo');
    exportJSONBackup(ctx.getSettings(), ctx.getEntries(), code);
    ctx.showToast('Backup salvo com sucesso!');
  });

  document.getElementById('exportModalImportJsonInput')?.addEventListener('change', (e) => {
    ctx.onImportJsonEvent(e);
  });

  return {
    openExportModal,
    closeExportModal,
    refreshExportPreview,
    triggerNativePrint
  };
}
