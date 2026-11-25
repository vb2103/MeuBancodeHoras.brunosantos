import {
  ENTRY_CATEGORIES,
  addDaysToISO,
  escapeHtml,
  escapeXml,
  formatDateBR,
  getLocalDateISO,
  isValidISODate,
  sanitizeCsvCell,
  sanitizePdfText
} from './config.js';
import { getActiveRuleSummary } from './rules-catalog.js';
import { computeAnalyticsSummary, formatDaysFromMinutes, formatHHMM, getExpiryBadge, minutesToDecimalHours } from './time.js';

function triggerDownload(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Resume totais inteiros de um recorte cronológico.
 */
export function computeExportSummary(rows = []) {
  let realizedMinutes = 0;
  let projectedMinutes = 0;
  let creditsMinutes = 0;
  let debitsMinutes = 0;
  let workedMinutesTotal = 0;
  let bonusMinutes = 0;
  let creditsCount = 0;
  let debitsCount = 0;

  for (const item of rows) {
    const mins = Math.max(0, Math.round(Number(item.minutes) || 0));
    const delta = Number(item.deltaMinutes ?? (item.type === 'credit' ? mins : -mins));
    projectedMinutes += delta;
    if (item.status === 'realized') realizedMinutes += delta;

    if (item.type === 'credit') {
      const worked = Math.max(0, Math.round(Number(item.workedMinutes ?? mins)));
      workedMinutesTotal += worked;
      creditsMinutes += mins;
      bonusMinutes += Math.max(0, mins - worked);
      creditsCount += 1;
    } else {
      debitsMinutes += mins;
      debitsCount += 1;
    }
  }

  return {
    realizedMinutes,
    projectedMinutes,
    creditsMinutes,
    debitsMinutes,
    workedMinutesTotal,
    bonusMinutes,
    count: rows.length,
    creditsCount,
    debitsCount
  };
}

/**
 * Gera código verificador SHA-256 curto (ex.: SH-A1B2C3D4E5F6) para conferência de integridade.
 */
export async function computeIntegrityDigest(rows = [], settings = {}, scopeLabel = 'Extrato completo') {
  const canonical = JSON.stringify({
    scopeLabel,
    user: settings?.userName || '',
    dailyMinutes: Number(settings?.dailyMinutes) || 480,
    rows: rows.map((r) => [r.id || '', r.date, r.type, r.status, r.minutes, r.workedMinutes ?? r.minutes, r.multiplier ?? 1, r.expiry || ''])
  });

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buf = new TextEncoder().encode(canonical);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12)
        .toUpperCase();
      return `SH-${hex}`;
    }
  } catch {
    // Fallback determinístico em ambiente sem SubtleCrypto
  }

  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  for (let i = 0; i < canonical.length; i += 1) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 2246822519) >>> 0;
  }
  return `SH-${h1.toString(16).padStart(8, '0').toUpperCase()}${h2.toString(16).padStart(4, '0').toUpperCase().slice(0, 4)}`;
}

export function exportCSV(chronoEntries, options = {}) {
  if (!Array.isArray(chronoEntries) || chronoEntries.length === 0) {
    throw new Error('Nenhum lançamento encontrado no recorte selecionado para exportar CSV.');
  }

  const includeSummary = options.includeSummary !== false;
  const headers = [
    'Data',
    'Evento',
    'Categoria',
    'Tipo',
    'Status',
    'Tempo_Trabalhado_HHMM',
    'Multiplicador',
    'Saldo_Aplicado_HHMM',
    'Saldo_Decimal_Horas',
    'Saldo_Acumulado_HHMM',
    'Vencimento',
    'Observacoes'
  ];

  const rows = chronoEntries.map((i) => [
    formatDateBR(i.date),
    sanitizeCsvCell(i.title || ''),
    ENTRY_CATEGORIES[i.category]?.label || 'Manual',
    i.type === 'credit' ? 'Credito' : 'Debito',
    i.status === 'realized' ? 'Realizado' : 'Previsto',
    formatHHMM(i.workedMinutes ?? i.minutes, false),
    String(i.multiplier ?? 1).replace('.', ','),
    formatHHMM(i.deltaMinutes, true),
    String(i.type === 'credit' ? minutesToDecimalHours(i.minutes) : -minutesToDecimalHours(i.minutes)).replace('.', ','),
    formatHHMM(i.runningMinutes, true),
    i.expiry ? formatDateBR(i.expiry) : '',
    sanitizeCsvCell(i.notes || '')
  ]);

  if (includeSummary) {
    const sum = computeExportSummary(chronoEntries);
    rows.push([
      'TOTAL',
      sanitizeCsvCell(`Resumo do Recorte (${sum.count} registros)`),
      'Resumo',
      '-',
      '-',
      formatHHMM(sum.workedMinutesTotal, false),
      '-',
      formatHHMM(sum.projectedMinutes, true),
      String(minutesToDecimalHours(sum.projectedMinutes)).replace('.', ','),
      formatHHMM(sum.realizedMinutes, true),
      '',
      sanitizeCsvCell(`Realizado: ${formatHHMM(sum.realizedMinutes, true)} | Projetado: ${formatHHMM(sum.projectedMinutes, true)}`)
    ]);
  }

  const csv = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  triggerDownload(csv, 'text/csv;charset=utf-8;', `saldohoras-extrato-${getLocalDateISO()}.csv`);
}

function normalizePdfOptions(userEmailOrOptions, legacyScopeLabel) {
  if (typeof userEmailOrOptions === 'object' && userEmailOrOptions !== null) {
    return {
      userEmail: userEmailOrOptions.userEmail || '',
      scopeLabel: userEmailOrOptions.scopeLabel || 'Extrato completo',
      globalChrono: Array.isArray(userEmailOrOptions.globalChrono) ? userEmailOrOptions.globalChrono : null,
      remainingMap: userEmailOrOptions.remainingMap instanceof Map ? userEmailOrOptions.remainingMap : new Map(),
      includeFifo: userEmailOrOptions.includeFifo !== false,
      includeSignatures: userEmailOrOptions.includeSignatures !== false,
      orientation: userEmailOrOptions.orientation === 'portrait' ? 'portrait' : 'landscape',
      integrityCode: userEmailOrOptions.integrityCode || ''
    };
  }
  return {
    userEmail: userEmailOrOptions || '',
    scopeLabel: legacyScopeLabel || 'Extrato completo',
    globalChrono: null,
    remainingMap: new Map(),
    includeFifo: true,
    includeSignatures: true,
    orientation: 'landscape',
    integrityCode: ''
  };
}

export function exportPDF(chronoEntries, settings, userEmailOrOptions = '', legacyScopeLabel = 'Extrato completo') {
  if (!Array.isArray(chronoEntries) || chronoEntries.length === 0) {
    throw new Error('Nenhum lançamento encontrado no recorte selecionado para exportar PDF.');
  }
  if (!window.jspdf?.jsPDF) {
    const err = new Error('Biblioteca jsPDF indisponível offline no momento.');
    err.code = 'JSPDF_UNAVAILABLE';
    throw err;
  }

  const opts = normalizePdfOptions(userEmailOrOptions, legacyScopeLabel);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: opts.orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  const recorteSummary = computeExportSummary(chronoEntries);
  const globalRows = opts.globalChrono || chronoEntries;
  const globalSummary = computeExportSummary(globalRows);
  const isFilteredRecorte = Boolean(opts.globalChrono && globalRows.length !== chronoEntries.length);

  const ownerName = sanitizePdfText(settings.userName || opts.userEmail || 'Colaborador');
  const ruleLabel = sanitizePdfText(getActiveRuleSummary(settings));
  const todayIso = getLocalDateISO();

  const metaLine = sanitizePdfText(
    `Colaborador: ${ownerName}  |  Regra: ${ruleLabel} (${settings.stateUf || 'SP'})  |  Jornada: ${formatHHMM(settings.dailyMinutes)}/dia  |  ${opts.scopeLabel}  |  Emitido: ${formatDateBR(todayIso)}`
  );
  doc.setFontSize(8.5);
  const metaWrapped = doc.splitTextToSize(metaLine, pageW - margin * 2);
  const bannerHeight = 18 + metaWrapped.length * 4.2 + 3;

  doc.setFillColor(30, 27, 75);
  doc.rect(0, 0, pageW, bannerHeight, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('SaldoHoras - Extrato Oficial de Banco de Horas & Folgas', margin, 11.5);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(metaWrapped, margin, 18);

  // Cards de resumo abaixo do banner
  let cursorY = bannerHeight + 5;
  const cards = [
    {
      title: isFilteredRecorte ? 'SALDO REALIZADO (CONTA)' : 'SALDO REALIZADO',
      value: `${formatHHMM(globalSummary.realizedMinutes, true)} (${formatDaysFromMinutes(globalSummary.realizedMinutes, settings.dailyMinutes)})`,
      fill: [236, 253, 245],
      stroke: [167, 243, 208],
      titleColor: [4, 120, 87]
    },
    {
      title: isFilteredRecorte ? 'SALDO PROJETADO (CONTA)' : 'SALDO PROJETADO',
      value: `${formatHHMM(globalSummary.projectedMinutes, true)} (${formatDaysFromMinutes(globalSummary.projectedMinutes, settings.dailyMinutes)})`,
      fill: [238, 242, 255],
      stroke: [199, 210, 254],
      titleColor: [67, 56, 202]
    },
    {
      title: isFilteredRecorte ? 'CREDITOS DO RECORTE' : 'CREDITOS (+ BONUS)',
      value: `${formatHHMM(recorteSummary.creditsMinutes, true)}${recorteSummary.bonusMinutes > 0 ? ` (+${formatHHMM(recorteSummary.bonusMinutes)} bonus)` : ''}`,
      fill: [240, 249, 255],
      stroke: [186, 230, 253],
      titleColor: [3, 105, 161]
    },
    {
      title: isFilteredRecorte ? 'DEBITOS DO RECORTE' : 'FOLGAS & SAIDAS',
      value: `${formatHHMM(-recorteSummary.debitsMinutes, false)} (${recorteSummary.debitsCount} reg.)`,
      fill: [255, 241, 242],
      stroke: [254, 205, 211],
      titleColor: [190, 18, 60]
    }
  ];

  const cardGap = 3;
  const cardW = (pageW - margin * 2 - cardGap * 3) / 4;
  cards.forEach((c, idx) => {
    const x = margin + idx * (cardW + cardGap);
    doc.setFillColor(...c.fill);
    doc.setDrawColor(...c.stroke);
    doc.roundedRect(x, cursorY, cardW, 13.5, 2, 2, 'FD');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...c.titleColor);
    doc.text(c.title, x + 2.5, cursorY + 4.5);
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(c.value), x + 2.5, cursorY + 10.2, { maxWidth: cardW - 5 });
  });
  cursorY += 16.5;

  if (isFilteredRecorte) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(
        `Nota: Recorte filtrado exibe ${chronoEntries.length} de ${globalRows.length} registros (saldo liquido do recorte: ${formatHHMM(recorteSummary.projectedMinutes, true)}). Os saldos da conta acima refletem todos os registros.`
      ),
      margin,
      cursorY
    );
    cursorY += 4.5;
  }

  const tableRows = chronoEntries.map((i) => {
    const isCredit = i.type === 'credit';
    const rem = opts.remainingMap.get(i.id) ?? i.minutes;
    let expiryText = '-';
    if (isCredit && i.expiry) {
      expiryText = sanitizePdfText(getExpiryBadge(i.expiry, rem, todayIso, i.minutes).label);
    }

    return [
      formatDateBR(i.date),
      sanitizePdfText(i.title),
      sanitizePdfText(ENTRY_CATEGORIES[i.category]?.label || 'Manual'),
      i.status === 'realized' ? 'Realizado' : 'Previsto',
      formatHHMM(i.workedMinutes ?? i.minutes, false),
      isCredit && Number(i.multiplier) !== 1 ? `${i.multiplier}x` : '1.0x',
      formatHHMM(i.deltaMinutes, true),
      formatHHMM(i.runningMinutes, true),
      expiryText,
      sanitizePdfText(i.notes || '')
    ];
  });

  const isLandscape = opts.orientation === 'landscape';
  doc.autoTable({
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Data', 'Evento / Descricao', 'Categoria', 'Status', 'Trab.', 'Fator', 'Saldo', 'Acum.', 'Validade / FIFO', 'Obs.']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: isLandscape ? 7.8 : 6.8 },
    bodyStyles: { fontSize: isLandscape ? 7.4 : 6.5, textColor: [30, 41, 59], cellPadding: 1.6 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: isLandscape ? 19 : 16 },
      2: { cellWidth: isLandscape ? 27 : 18 },
      3: { cellWidth: isLandscape ? 17 : 14 },
      4: { halign: 'right', cellWidth: isLandscape ? 14 : 11 },
      5: { halign: 'center', cellWidth: isLandscape ? 12 : 10 },
      6: { halign: 'right', fontStyle: 'bold', cellWidth: isLandscape ? 17 : 14 },
      7: { halign: 'right', fontStyle: 'bold', cellWidth: isLandscape ? 17 : 14 },
      8: { cellWidth: isLandscape ? 37 : 26 }
    },
    didParseCell(data) {
      if (data.section !== 'body') return;
      const rowItem = chronoEntries[data.row.index];
      if (!rowItem) return;
      if (data.column.index === 6) {
        data.cell.styles.textColor = rowItem.type === 'credit' ? [4, 120, 87] : [190, 18, 60];
      } else if (data.column.index === 3 && rowItem.status === 'planned') {
        data.cell.styles.textColor = [180, 83, 9];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  let nextY = (doc.lastAutoTable?.finalY || cursorY) + 6;

  // Bloco opcional de créditos abertos no FIFO
  if (opts.includeFifo) {
    const analytics = computeAnalyticsSummary(globalRows, opts.remainingMap, settings.dailyMinutes, todayIso);
    if (analytics.openBuckets.length > 0) {
      if (nextY > pageH - 42) {
        doc.addPage();
        nextY = 16;
      }
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Resumo de Creditos em Aberto (Ordem FIFO de Compensacao)', margin, nextY);
      nextY += 3;

      const fifoBody = analytics.openBuckets.map((b) => [
        formatDateBR(b.date),
        sanitizePdfText(b.title),
        formatHHMM(b.totalMinutes),
        formatHHMM(b.usedMinutes),
        formatHHMM(b.remainingMinutes),
        sanitizePdfText(b.badge.label)
      ]);

      doc.autoTable({
        startY: nextY,
        margin: { left: margin, right: margin, bottom: 16 },
        head: [['Origem', 'Evento', 'Total', 'Ja Compensado', 'Restante', 'Prazo / Situacao']],
        body: fifoBody,
        theme: 'grid',
        headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 7.2, textColor: [30, 41, 59], cellPadding: 1.5 },
        columnStyles: {
          0: { cellWidth: 21 },
          2: { halign: 'right', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 24 },
          4: { halign: 'right', fontStyle: 'bold', cellWidth: 18 }
        }
      });
      nextY = (doc.lastAutoTable?.finalY || nextY) + 8;
    }
  }

  // Quadro opcional de assinaturas
  if (opts.includeSignatures) {
    if (nextY > pageH - 34) {
      doc.addPage();
      nextY = 24;
    } else {
      nextY += 6;
    }
    const lineW = (pageW - margin * 2 - 24) / 2;
    const ySig = Math.max(nextY + 8, pageH - 26);

    doc.setDrawColor(148, 163, 184);
    doc.line(margin, ySig, margin + lineW, ySig);
    doc.line(margin + lineW + 24, ySig, margin + lineW * 2 + 24, ySig);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`${ownerName} (Colaborador)`, margin + lineW / 2, ySig + 4.5, { align: 'center' });
    doc.text('Gestao / Recursos Humanos', margin + lineW + 24 + lineW / 2, ySig + 4.5, { align: 'center' });
  }

  // Rodapé paginado em todas as páginas
  const totalPages = doc.getNumberOfPages();
  const codeNote = opts.integrityCode ? `  |  Cod. Verificacao: ${opts.integrityCode}` : '';
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`SaldoHoras - Banco de Horas 100% em HH:MM${codeNote}`, margin, pageH - 6.5);
    doc.text(`Pagina ${p} de ${totalPages}`, pageW - margin, pageH - 6.5, { align: 'right' });
  }

  const safeSlug = ownerName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Colaborador';
  doc.save(`SaldoHoras_${safeSlug}_${todayIso}.pdf`);
}

/**
 * Gera XML estruturado padronizado (<bancoHoras versao="1.0">) compatível com sistemas RH/ERP.
 */
export function generateStructuredXml(rows, remainingMap = new Map(), settings = {}, options = {}) {
  const todayIso = getLocalDateISO();
  const generatedAt = options.generatedAt || new Date().toISOString();
  const scopeLabel = options.scopeLabel || 'Extrato completo';
  const globalRows = Array.isArray(options.globalChrono) ? options.globalChrono : rows;
  const recorteSummary = computeExportSummary(rows);
  const globalSummary = computeExportSummary(globalRows);
  const analytics = computeAnalyticsSummary(globalRows, remainingMap, settings.dailyMinutes, todayIso);
  const integrityAttr = options.integrityCode ? ` codigoVerificacao="${escapeXml(options.integrityCode)}"` : '';

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bancoHoras versao="1.0" aplicacao="SaldoHoras" geradoEm="${escapeXml(generatedAt)}"${integrityAttr}>`,
    '  <metadados>',
    `    <escopo>${escapeXml(scopeLabel)}</escopo>`,
    `    <registrosRecorte>${rows.length}</registrosRecorte>`,
    `    <registrosTotaisConta>${globalRows.length}</registrosTotaisConta>`,
    '  </metadados>',
    '  <colaborador>',
    `    <nome>${escapeXml(settings.userName || options.userEmail || 'Colaborador')}</nome>`,
    `    <email>${escapeXml(options.userEmail || '')}</email>`,
    `    <uf>${escapeXml(settings.stateUf || 'SP')}</uf>`,
    `    <regraAtiva>${escapeXml(getActiveRuleSummary(settings))}</regraAtiva>`,
    `    <jornadaDiariaHHMM>${escapeXml(formatHHMM(settings.dailyMinutes || 480))}</jornadaDiariaHHMM>`,
    `    <jornadaDiariaMinutos>${Math.round(Number(settings.dailyMinutes) || 480)}</jornadaDiariaMinutos>`,
    `    <multiplicadorHoraExtra>${Number(settings.overtimeMultiplier) || 1.5}</multiplicadorHoraExtra>`,
    `    <multiplicadorFeriado>${Number(settings.holidayMultiplier) || 1.4}</multiplicadorFeriado>`,
    `    <validadePadraoDias>${Number(settings.expiryDays) || 180}</validadePadraoDias>`,
    '  </colaborador>',
    '  <resumoConta>',
    `    <saldoRealizadoHHMM>${escapeXml(formatHHMM(globalSummary.realizedMinutes, true))}</saldoRealizadoHHMM>`,
    `    <saldoRealizadoMinutos>${globalSummary.realizedMinutes}</saldoRealizadoMinutos>`,
    `    <saldoProjetadoHHMM>${escapeXml(formatHHMM(globalSummary.projectedMinutes, true))}</saldoProjetadoHHMM>`,
    `    <saldoProjetadoMinutos>${globalSummary.projectedMinutes}</saldoProjetadoMinutos>`,
    `    <totalCreditosRecorteHHMM>${escapeXml(formatHHMM(recorteSummary.creditsMinutes, true))}</totalCreditosRecorteHHMM>`,
    `    <totalDebitosRecorteHHMM>${escapeXml(formatHHMM(-recorteSummary.debitsMinutes, false))}</totalDebitosRecorteHHMM>`,
    `    <bonusMultiplicadoresRecorteHHMM>${escapeXml(formatHHMM(recorteSummary.bonusMinutes, true))}</bonusMultiplicadoresRecorteHHMM>`,
    '  </resumoConta>',
    '  <vencimentosFifo>'
  ];

  analytics.openBuckets.forEach((b) => {
    lines.push(
      `    <creditoAberto id="${escapeXml(b.id || b.date)}" dataOrigem="${escapeXml(b.date)}" vencimento="${escapeXml(b.expiry || '')}" totalHHMM="${escapeXml(formatHHMM(b.totalMinutes))}" compensadoHHMM="${escapeXml(formatHHMM(b.usedMinutes))}" restanteHHMM="${escapeXml(formatHHMM(b.remainingMinutes))}" situacao="${escapeXml(b.badge.label)}">` +
      `${escapeXml(b.title)}</creditoAberto>`
    );
  });
  lines.push('  </vencimentosFifo>');
  lines.push('  <lancamentos>');

  rows.forEach((i) => {
    const isCredit = i.type === 'credit';
    const rem = remainingMap.get(i.id) ?? i.minutes;
    lines.push('    <lancamento>');
    lines.push(`      <id>${escapeXml(i.id || '')}</id>`);
    lines.push(`      <data>${escapeXml(i.date || '')}</data>`);
    lines.push(`      <titulo>${escapeXml(i.title || '')}</titulo>`);
    lines.push(`      <categoria>${escapeXml(i.category || 'manual')}</categoria>`);
    lines.push(`      <categoriaNome>${escapeXml(ENTRY_CATEGORIES[i.category]?.label || 'Manual')}</categoriaNome>`);
    lines.push(`      <tipo>${escapeXml(i.type || 'credit')}</tipo>`);
    lines.push(`      <status>${escapeXml(i.status || 'realized')}</status>`);
    lines.push(`      <trabalhadoHHMM>${escapeXml(formatHHMM(i.workedMinutes ?? i.minutes, false))}</trabalhadoHHMM>`);
    lines.push(`      <trabalhadoMinutos>${Math.round(Number(i.workedMinutes ?? i.minutes) || 0)}</trabalhadoMinutos>`);
    lines.push(`      <multiplicador>${Number(i.multiplier) || 1}</multiplicador>`);
    lines.push(`      <saldoAplicadoHHMM>${escapeXml(formatHHMM(i.deltaMinutes, true))}</saldoAplicadoHHMM>`);
    lines.push(`      <saldoAplicadoMinutos>${Number(i.deltaMinutes) || 0}</saldoAplicadoMinutos>`);
    lines.push(`      <saldoAcumuladoHHMM>${escapeXml(formatHHMM(i.runningMinutes, true))}</saldoAcumuladoHHMM>`);
    lines.push(`      <vencimento>${escapeXml(isCredit ? (i.expiry || '') : '')}</vencimento>`);
    lines.push(`      <restanteFifoHHMM>${escapeXml(isCredit ? formatHHMM(rem) : '00:00')}</restanteFifoHHMM>`);
    lines.push(`      <observacoes>${escapeXml(i.notes || '')}</observacoes>`);
    lines.push('    </lancamento>');
  });

  lines.push('  </lancamentos>');
  lines.push('</bancoHoras>');
  return lines.join('\n') + '\n';
}

export function exportStructuredXML(rows, remainingMap, settings, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Nenhum lançamento encontrado no recorte selecionado para exportar XML.');
  }
  const xml = generateStructuredXml(rows, remainingMap, settings, options);
  triggerDownload(xml, 'application/xml;charset=utf-8;', `saldohoras-extrato-${getLocalDateISO()}.xml`);
}

function xmlCell(value, styleId = 'sCell', type = 'String') {
  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

/**
 * Gera planilha Excel nativa em XML (SpreadsheetML 2003) com 2 abas formatadas.
 */
export function generateExcelSpreadsheetXml(rows, remainingMap = new Map(), settings = {}, options = {}) {
  const todayIso = getLocalDateISO();
  const globalRows = Array.isArray(options.globalChrono) ? options.globalChrono : rows;
  const recorteSummary = computeExportSummary(rows);
  const globalSummary = computeExportSummary(globalRows);
  const analytics = computeAnalyticsSummary(globalRows, remainingMap, settings.dailyMinutes, todayIso);
  const ownerName = settings.userName || options.userEmail || 'Colaborador';

  const summaryRowsXml = [
    `<Row>${xmlCell('SaldoHoras — Relatório de Banco de Horas', 'sTitle')}</Row>`,
    `<Row>${xmlCell('Colaborador', 'sBold')}${xmlCell(ownerName)}${xmlCell('Regra', 'sBold')}${xmlCell(`${getActiveRuleSummary(settings)} (${settings.stateUf || 'SP'})`)}</Row>`,
    `<Row>${xmlCell('Jornada Base', 'sBold')}${xmlCell(`${formatHHMM(settings.dailyMinutes || 480)}/dia`)}${xmlCell('Escopo', 'sBold')}${xmlCell(options.scopeLabel || 'Extrato completo')}</Row>`,
    `<Row>${xmlCell('Saldo Realizado (Conta)', 'sBold')}${xmlCell(formatHHMM(globalSummary.realizedMinutes, true), 'sCredit')}${xmlCell('Saldo Projetado (Conta)', 'sBold')}${xmlCell(formatHHMM(globalSummary.projectedMinutes, true), 'sBold')}</Row>`,
    `<Row>${xmlCell('Créditos do Recorte', 'sBold')}${xmlCell(formatHHMM(recorteSummary.creditsMinutes, true), 'sCredit')}${xmlCell('Folgas do Recorte', 'sBold')}${xmlCell(formatHHMM(-recorteSummary.debitsMinutes, false), 'sDebit')}</Row>`,
    '<Row></Row>',
    `<Row>${xmlCell('Créditos Abertos (FIFO)', 'sHeader')}${xmlCell('Data Origem', 'sHeader')}${xmlCell('Total', 'sHeader')}${xmlCell('Já Compensado', 'sHeader')}${xmlCell('Restante', 'sHeader')}${xmlCell('Vencimento / Situação', 'sHeader')}</Row>`,
    ...analytics.openBuckets.map((b) =>
      `<Row>${xmlCell(b.title)}${xmlCell(formatDateBR(b.date))}${xmlCell(formatHHMM(b.totalMinutes))}${xmlCell(formatHHMM(b.usedMinutes))}${xmlCell(formatHHMM(b.remainingMinutes), 'sBold')}${xmlCell(b.badge.label)}</Row>`
    )
  ].join('\n      ');

  const extractHeaders = ['Data', 'Evento / Descrição', 'Categoria', 'Tipo', 'Status', 'Trab. (HH:MM)', 'Multiplicador', 'Saldo (HH:MM)', 'Saldo Decimal (h)', 'Acumulado (HH:MM)', 'Vencimento', 'Observações'];
  const extractHeaderXml = `<Row>${extractHeaders.map((h) => xmlCell(h, 'sHeader')).join('')}</Row>`;
  const extractRowsXml = rows.map((i) => {
    const isCredit = i.type === 'credit';
    const deltaStyle = isCredit ? 'sCredit' : 'sDebit';
    const dec = isCredit ? minutesToDecimalHours(i.minutes) : -minutesToDecimalHours(i.minutes);
    return `<Row>` +
      xmlCell(formatDateBR(i.date)) +
      xmlCell(i.title || '') +
      xmlCell(ENTRY_CATEGORIES[i.category]?.label || 'Manual') +
      xmlCell(isCredit ? 'Crédito' : 'Débito') +
      xmlCell(i.status === 'realized' ? 'Realizado' : 'Previsto') +
      xmlCell(formatHHMM(i.workedMinutes ?? i.minutes, false)) +
      xmlCell(Number(i.multiplier) || 1, 'sCell', 'Number') +
      xmlCell(formatHHMM(i.deltaMinutes, true), deltaStyle) +
      xmlCell(dec, deltaStyle, 'Number') +
      xmlCell(formatHHMM(i.runningMinutes, true), 'sBold') +
      xmlCell(i.expiry ? formatDateBR(i.expiry) : '') +
      xmlCell(i.notes || '') +
      `</Row>`;
  }).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Calibri" ss:Size="10"/></Style>
    <Style ss:ID="sTitle"><Font ss:FontName="Calibri" ss:Size="13" ss:Bold="1" ss:Color="#312E81"/></Style>
    <Style ss:ID="sHeader"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4F46E5" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sBold"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1"/></Style>
    <Style ss:ID="sCredit"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#047857"/></Style>
    <Style ss:ID="sDebit"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#BE123C"/></Style>
    <Style ss:ID="sCell"><Font ss:FontName="Calibri" ss:Size="10"/></Style>
  </Styles>
  <Worksheet ss:Name="Resumo e FIFO">
    <Table>
      <Column ss:Width="170"/><Column ss:Width="140"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="90"/><Column ss:Width="160"/>
      ${summaryRowsXml}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Extrato Cronologico">
    <Table>
      <Column ss:Width="75"/><Column ss:Width="200"/><Column ss:Width="115"/><Column ss:Width="65"/><Column ss:Width="70"/><Column ss:Width="80"/><Column ss:Width="75"/><Column ss:Width="85"/><Column ss:Width="85"/><Column ss:Width="95"/><Column ss:Width="80"/><Column ss:Width="170"/>
      ${extractHeaderXml}
      ${extractRowsXml}
    </Table>
  </Worksheet>
</Workbook>
`;
}

export function exportExcelXML(rows, remainingMap, settings, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Nenhum lançamento encontrado no recorte selecionado para exportar planilha Excel.');
  }
  const xml = generateExcelSpreadsheetXml(rows, remainingMap, settings, options);
  triggerDownload(xml, 'application/vnd.ms-excel;charset=utf-8;', `saldohoras-planilha-${getLocalDateISO()}.xls`);
}

/**
 * Monta visão limpa para impressão nativa / fallback offline de PDF (@media print).
 */
export function renderPrintReportSheet(containerEl, rows, settings, options = {}) {
  if (!containerEl) return;
  const globalRows = Array.isArray(options.globalChrono) ? options.globalChrono : rows;
  const recorteSummary = computeExportSummary(rows);
  const globalSummary = computeExportSummary(globalRows);
  const remainingMap = options.remainingMap instanceof Map ? options.remainingMap : new Map();
  const ownerName = settings.userName || options.userEmail || 'Colaborador';
  const todayIso = getLocalDateISO();
  const analytics = computeAnalyticsSummary(globalRows, remainingMap, settings.dailyMinutes, todayIso);

  const tableRowsHtml = rows.map((i) => {
    const isCredit = i.type === 'credit';
    const rem = remainingMap.get(i.id) ?? i.minutes;
    const fifoText = isCredit && i.expiry ? getExpiryBadge(i.expiry, rem, todayIso, i.minutes).label : '—';
    return `
      <tr>
        <td>${escapeHtml(formatDateBR(i.date))}</td>
        <td><strong>${escapeHtml(i.title || '')}</strong>${i.notes ? `<div style="font-size:10px;color:#64748b">${escapeHtml(i.notes)}</div>` : ''}</td>
        <td>${escapeHtml(ENTRY_CATEGORIES[i.category]?.label || 'Manual')}</td>
        <td>${i.status === 'realized' ? 'Realizado' : 'Previsto'}</td>
        <td style="text-align:right;font-family:monospace">${escapeHtml(formatHHMM(i.workedMinutes ?? i.minutes, false))}</td>
        <td style="text-align:center">${isCredit && Number(i.multiplier) !== 1 ? `${i.multiplier}x` : '1.0x'}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;color:${isCredit ? '#047857' : '#be123c'}">${escapeHtml(formatHHMM(i.deltaMinutes, true))}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${escapeHtml(formatHHMM(i.runningMinutes, true))}</td>
        <td>${escapeHtml(fifoText)}</td>
      </tr>
    `;
  }).join('');

  const fifoHtml = options.includeFifo !== false && analytics.openBuckets.length > 0
    ? `
      <h2 style="font-size:13px;font-weight:700;margin:18px 0 6px;">Créditos em Aberto (Ordem FIFO)</h2>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Origem</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Evento</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:right;">Total</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:right;">Compensado</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:right;">Restante</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Prazo / Situação</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.openBuckets.map((b) => `
            <tr>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;">${escapeHtml(formatDateBR(b.date))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;">${escapeHtml(b.title)}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(b.totalMinutes))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(b.usedMinutes))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:right;font-family:monospace;font-weight:700;">${escapeHtml(formatHHMM(b.remainingMinutes))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;">${escapeHtml(b.badge.label)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
    : '';

  const signaturesHtml = options.includeSignatures !== false
    ? `
      <div style="display:flex;justify-content:space-between;gap:40px;margin-top:36px;">
        <div style="flex:1;border-top:1px solid #64748b;padding-top:6px;text-align:center;font-size:11px;">${escapeHtml(ownerName)} (Colaborador)</div>
        <div style="flex:1;border-top:1px solid #64748b;padding-top:6px;text-align:center;font-size:11px;">Gestão / Recursos Humanos</div>
      </div>
    `
    : '';

  containerEl.innerHTML = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a;padding:12px;">
      <div style="border-bottom:2px solid #312e81;padding-bottom:10px;margin-bottom:12px;">
        <h1 style="font-size:18px;font-weight:800;margin:0;">SaldoHoras — Extrato Oficial de Banco de Horas &amp; Folgas</h1>
        <p style="font-size:11px;color:#475569;margin:4px 0 0;">
          <strong>Colaborador:</strong> ${escapeHtml(ownerName)} &bull;
          <strong>Regra:</strong> ${escapeHtml(getActiveRuleSummary(settings))} (${escapeHtml(settings.stateUf || 'SP')}) &bull;
          <strong>Jornada:</strong> ${escapeHtml(formatHHMM(settings.dailyMinutes || 480))}/dia &bull;
          <strong>Escopo:</strong> ${escapeHtml(options.scopeLabel || 'Extrato completo')} &bull;
          <strong>Emitido:</strong> ${escapeHtml(formatDateBR(todayIso))}
        </p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;font-size:11px;">
        <div style="border:1px solid #cbd5e1;padding:8px;border-radius:6px;">
          <div style="color:#047857;font-weight:700;">Saldo Realizado</div>
          <div style="font-size:13px;font-weight:800;font-family:monospace;">${escapeHtml(formatHHMM(globalSummary.realizedMinutes, true))}</div>
        </div>
        <div style="border:1px solid #cbd5e1;padding:8px;border-radius:6px;">
          <div style="color:#4338ca;font-weight:700;">Saldo Projetado</div>
          <div style="font-size:13px;font-weight:800;font-family:monospace;">${escapeHtml(formatHHMM(globalSummary.projectedMinutes, true))}</div>
        </div>
        <div style="border:1px solid #cbd5e1;padding:8px;border-radius:6px;">
          <div style="color:#0369a1;font-weight:700;">Créditos Recorte</div>
          <div style="font-size:13px;font-weight:800;font-family:monospace;">${escapeHtml(formatHHMM(recorteSummary.creditsMinutes, true))}</div>
        </div>
        <div style="border:1px solid #cbd5e1;padding:8px;border-radius:6px;">
          <div style="color:#be123c;font-weight:700;">Folgas Recorte</div>
          <div style="font-size:13px;font-weight:800;font-family:monospace;">${escapeHtml(formatHHMM(-recorteSummary.debitsMinutes, false))}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#312e81;color:#ffffff;">
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Data</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Evento</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Categoria</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Status</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right;">Trab.</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:center;">Fator</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right;">Saldo</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right;">Acum.</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Validade / FIFO</th>
          </tr>
        </thead>
        <tbody>${tableRowsHtml}</tbody>
      </table>
      ${fifoHtml}
      ${signaturesHtml}
      ${options.integrityCode ? `<p style="font-size:10px;color:#64748b;margin-top:16px;">Código de verificação: ${escapeHtml(options.integrityCode)}</p>` : ''}
    </div>
  `;
}

export function exportJSONBackup(settings, entries, integrityCode = '') {
  const payload = {
    app: 'SaldoHoras',
    version: 2,
    exportedAt: new Date().toISOString(),
    ...(integrityCode ? { integrityCode } : {}),
    settings,
    entries
  };
  triggerDownload(JSON.stringify(payload, null, 2), 'application/json', `saldohoras-backup-${getLocalDateISO()}.json`);
}

export function buildCommunicationTemplates(chronoEntries, settings) {
  const realizedMins = chronoEntries.filter((i) => i.status === 'realized').reduce((s, i) => s + i.deltaMinutes, 0);
  const projectedMins = chronoEntries.reduce((s, i) => s + i.deltaMinutes, 0);
  const plannedDebits = chronoEntries.filter((i) => i.status === 'planned' && i.type === 'debit');
  const senderName = settings.userName || 'Colaborador';
  const ruleLabel = getActiveRuleSummary(settings);

  const plannedLines = plannedDebits.length
    ? plannedDebits.map((p) => `• ${formatDateBR(p.date)}: ${p.title} (${formatHHMM(-p.minutes)})`).join('\n')
    : '• Nenhuma folga futura agendada no momento.';

  const emailText =
    `Assunto: Alinhamento de Banco de Horas e Folgas Compensatórias — ${senderName}

Olá, tudo bem?

Segue o resumo atualizado do meu banco de horas para alinhamento e registro:

• Saldo Realizado (disponível hoje): ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})
• Saldo Projetado (considerando agendamentos): ${formatHHMM(projectedMins, true)} (${formatDaysFromMinutes(projectedMins, settings.dailyMinutes)})
• Jornada de referência: ${formatHHMM(settings.dailyMinutes)}/dia (${ruleLabel})

Compensações / Folgas previstas:
${plannedLines}

Fico à disposição para confirmarmos as datas sem impacto na operação.

Atenciosamente,
${senderName}`;

  const whatsappText =
    `Olá! Tudo certo? Passando para alinhar meu *Banco de Horas*:\n\n` +
    `✅ *Saldo disponível hoje:* ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})\n` +
    `📅 *Saldo projetado:* ${formatHHMM(projectedMins, true)} (${formatDaysFromMinutes(projectedMins, settings.dailyMinutes)})\n` +
    `⏱️ *Jornada base:* ${formatHHMM(settings.dailyMinutes)}/dia\n\n` +
    `*Folgas previstas:*\n${plannedLines}\n\n` +
    `Podemos confirmar essas datas? — _${senderName}_`;

  return { emailText, whatsappText };
}

export async function copyElementText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return false;
  const value = el.value ?? '';

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Continua para fallback legado
  }

  try {
    el.select();
    el.setSelectionRange(0, value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

function escapeIcsText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toIcsUtcStamp(dateObj = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${dateObj.getUTCFullYear()}${pad(dateObj.getUTCMonth() + 1)}${pad(dateObj.getUTCDate())}` +
    `T${pad(dateObj.getUTCHours())}${pad(dateObj.getUTCMinutes())}${pad(dateObj.getUTCSeconds())}Z`
  );
}

/**
 * Gera conteúdo RFC 5545 (.ics) compatível com Google Calendar, Outlook e Apple Calendar.
 */
export function generateIcsContent(events = [], nowDate = new Date()) {
  const dtStamp = toIcsUtcStamp(nowDate);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SaldoHoras//Banco de Horas & Folgas//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  events.forEach((ev, idx) => {
    if (!ev || !isValidISODate(ev.date)) return;
    const endDate = addDaysToISO(ev.date, 1);
    const startCompact = ev.date.replace(/-/g, '');
    const endCompact = endDate.replace(/-/g, '');
    const uid = String(ev.uid || `saldohoras-${startCompact}-${idx}`).replace(/[^a-zA-Z0-9._@-]/g, '');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}@saldohoras.app`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${startCompact}`);
    lines.push(`DTEND;VALUE=DATE:${endCompact}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary || 'SaldoHoras')}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    if (Number(ev.alarmDaysBefore) > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(ev.summary || 'Lembrete SaldoHoras')}`);
      lines.push(`TRIGGER:-P${Math.round(Number(ev.alarmDaysBefore))}D`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function downloadIcsEvents(events, filename = `saldohoras-agenda-${getLocalDateISO()}.ics`) {
  const valid = (events || []).filter((e) => e && isValidISODate(e.date));
  if (!valid.length) {
    throw new Error('Nenhum evento agendado ou vencimento válido para exportar na agenda.');
  }
  const ics = generateIcsContent(valid);
  triggerDownload(ics, 'text/calendar;charset=utf-8', filename);
}

/**
 * Converte lançamentos previstos e vencimentos FIFO em aberto para eventos de agenda (.ics).
 */
export function buildCalendarEventsFromEntries(chronoEntries, remainingMap = new Map(), settings = {}) {
  const events = [];
  const dailyMins = Number(settings?.dailyMinutes) || 480;

  for (const item of chronoEntries || []) {
    if (item.status === 'planned' && isValidISODate(item.date)) {
      const sign = item.type === 'credit' ? '+' : '-';
      events.push({
        uid: `planned-${item.id || item.date}`,
        date: item.date,
        summary: `SaldoHoras: ${item.title} (${sign}${formatHHMM(item.minutes)})`,
        description: `${item.type === 'debit' ? 'Folga/saída prevista' : 'Crédito previsto'} • Equivalente a ${formatDaysFromMinutes(item.minutes, dailyMins)}. ${item.notes || ''}`.trim(),
        alarmDaysBefore: 1
      });
    }
    if (item.type === 'credit' && isValidISODate(item.expiry)) {
      const rem = remainingMap.get(item.id) ?? item.minutes;
      if (rem > 0) {
        events.push({
          uid: `expiry-${item.id || item.expiry}`,
          date: item.expiry,
          summary: `Vencimento SaldoHoras: ${item.title} (${formatHHMM(rem)})`,
          description: `Prazo limite FIFO para compensar ${formatHHMM(rem)} acumulados em ${formatDateBR(item.date)}.`,
          alarmDaysBefore: 15
        });
      }
    }
  }

  return events;
}
