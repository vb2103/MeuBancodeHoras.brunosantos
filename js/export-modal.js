import {
  buildCalendarEventsFromEntries,
  computeExportSummary,
  computeIntegrityDigest,
  downloadIcsEvents,
  exportCSV,
  exportExcelXML,
  exportJSONBackup,
  exportPDF,
  exportStructuredXML,
  renderPrintReportSheet
} from './export.js';
import { formatHHMM } from './time.js';

export function createExportModalManager(ctx) {
  const modal = document.getElementById('exportModal');
  const customBox = document.getElementById('exportCustomDatesBox');
  const dateFromEl = document.getElementById('exportDateFrom');
  const dateToEl = document.getElementById('exportDateTo');
  const customRealizedOnlyEl = document.getElementById('exportCustomRealizedOnly');

  function getActiveScope() {
    return document.querySelector('input[name="exportScope"]:checked')?.value || 'all';
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

    return { chrono, remainingMap, rows, scopeLabel };
  }

  function refreshExportPreview() {
    const scope = getActiveScope();
    customBox?.classList.toggle('hidden', scope !== 'custom');

    const { chrono, rows } = resolveScopedData();
    const recSum = computeExportSummary(rows);
    const globSum = computeExportSummary(chrono);

    const countEl = document.getElementById('exportPreviewCount');
    const recSaldoEl = document.getElementById('exportPreviewRecorteSaldo');
    const globSaldoEl = document.getElementById('exportPreviewGlobalSaldo');

    if (countEl) {
      countEl.textContent = rows.length
        ? `${rows.length} de ${chrono.length} registros (${recSum.creditsCount} créditos • ${recSum.debitsCount} folgas)`
        : '0 registros encontrados neste recorte';
    }
    if (recSaldoEl) recSaldoEl.textContent = formatHHMM(recSum.projectedMinutes, true);
    if (globSaldoEl) globSaldoEl.textContent = formatHHMM(globSum.projectedMinutes, true);
  }

  function openExportModal() {
    ctx.captureLastFocus();
    const { hasActiveFilters } = ctx.getExportContext();
    const preferredScope = hasActiveFilters ? 'screen' : 'all';
    const radio = document.querySelector(`input[name="exportScope"][value="${preferredScope}"]`);
    if (radio) radio.checked = true;

    refreshExportPreview();
    modal.classList.remove('hidden');
    window.lucide?.createIcons();
    document.getElementById('closeExportModalBtn')?.focus();
  }

  function closeExportModal() {
    modal.classList.add('hidden');
    ctx.restoreLastFocus();
  }

  ctx.registerExternalModal('exportModal', closeExportModal);

  document.getElementById('closeExportModalBtn')?.addEventListener('click', closeExportModal);
  document.getElementById('cancelExportModalBtn')?.addEventListener('click', closeExportModal);
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
    const opts = await buildExportOptions(data);
    try {
      exportPDF(data.rows, ctx.getSettings(), opts);
      ctx.showToast('Relatório PDF oficial baixado!');
    } catch (err) {
      if (err?.code === 'JSPDF_UNAVAILABLE') {
        ctx.showToast('PDF offline indisponível — abrindo impressão nativa limpa...');
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
      ctx.showToast('XML estruturado (.xml) baixado!');
    } catch (err) {
      ctx.showToast(err.message || 'Erro ao gerar XML');
    }
  });

  document.getElementById('modalDownloadExcelXmlBtn')?.addEventListener('click', async () => {
    const data = resolveScopedData();
    const opts = await buildExportOptions(data);
    try {
      exportExcelXML(data.rows, data.remainingMap, ctx.getSettings(), opts);
      ctx.showToast('Planilha Excel (.xls) baixada!');
    } catch (err) {
      ctx.showToast(err.message || 'Erro ao gerar Excel XML');
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
    const code = await computeIntegrityDigest(chrono, ctx.getSettings(), 'Backup JSON Completo');
    exportJSONBackup(ctx.getSettings(), ctx.getEntries(), code);
    ctx.showToast('Backup JSON completo baixado!');
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
