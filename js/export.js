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
import {
  applyMultiplierToMinutes,
  computeAnalyticsSummary,
  formatDaysFromMinutes,
  formatHHMM,
  getExpiryBadge,
  isInitialBalanceEntry,
  isWriteOffEntry,
  minutesToDecimalHours
} from './time.js';

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

function formatCleanEntryTitle(item) {
  const rawTitle = String(item?.title || '').trim();
  if (!rawTitle) return '';
  if (item?.category === 'holiday') {
    return rawTitle.replace(/\s*\((?:Plantão\/Feriado|Feriado)\)\s*$/i, '').trim() || rawTitle;
  }
  return rawTitle;
}

function getEntryTypeDisplayLabel(item, includePlannedTag = false) {
  let base = 'Manual';
  if (isInitialBalanceEntry(item)) base = 'Saldo Inicial';
  else if (isWriteOffEntry(item)) base = 'Encerramento / Baixa';
  else if (item?.category === 'holiday') base = 'Feriado Trabalhado';
  else if (item?.category === 'overtime') base = 'Hora Extra';
  else if (item?.category === 'time_off') base = 'Folga Compensatória';
  else if (item?.category === 'adjustment') base = 'Ajuste de Saldo';

  if (includePlannedTag && item?.status === 'planned') {
    return `${base} [Previsto]`;
  }
  return base;
}

function getCleanEntryNotes(item) {
  const note = String(item?.notes || '').trim();
  if (!note) return '';
  if (item?.category === 'holiday' && /^Feriado\s+(Nacional|Estadual|Municipal)$/i.test(note)) {
    return '';
  }
  const cleanTitle = formatCleanEntryTitle(item);
  if (note.toLowerCase() === cleanTitle.toLowerCase()) return '';
  return note;
}

function formatRuleFactorDisplay(item) {
  if (item?.type === 'debit') return '-';
  const mult = Number(item?.multiplier);
  if (!Number.isFinite(mult) || mult <= 0) return '1.0x';
  return Number.isInteger(mult) ? `${mult}.0x` : `${String(mult).replace(',', '.')}x`;
}

function formatFifoExpiryClean(bucket) {
  if (!bucket?.expiry || !isValidISODate(bucket.expiry)) return 'Sem vencimento';
  const brDate = formatDateBR(bucket.expiry);
  if (bucket.badge?.isExpired) return `${brDate} (Vencido)`;
  if (typeof bucket.badge?.daysRemaining === 'number' && bucket.badge.daysRemaining <= 60) {
    return `${brDate} (${bucket.badge.daysRemaining}d)`;
  }
  return brDate;
}

export function generateCsvContent(chronoEntries, options = {}) {
  if (!Array.isArray(chronoEntries) || chronoEntries.length === 0) {
    throw new Error('Nenhum lançamento encontrado no recorte selecionado para exportar CSV.');
  }

  const includeSummary = options.includeSummary !== false;
  const headers = [
    'Data',
    'Descrição',
    'Categoria',
    'Tipo',
    'Status',
    'Horas Trabalhadas (HH:MM)',
    'Regra',
    'Impacto (HH:MM)',
    'Impacto Decimal (h)',
    'Saldo Acumulado (HH:MM)',
    'Vencimento',
    'Observações'
  ];

  const rows = chronoEntries.map((i) => {
    const isCredit = i.type === 'credit';
    return [
      formatDateBR(i.date),
      sanitizeCsvCell(formatCleanEntryTitle(i)),
      sanitizeCsvCell(getEntryTypeDisplayLabel(i, false)),
      isCredit ? 'Crédito' : 'Débito',
      i.status === 'realized' ? 'Realizado' : 'Previsto',
      formatHHMM(i.workedMinutes ?? i.minutes, false),
      isCredit ? String(i.multiplier ?? 1).replace('.', ',') : '-',
      formatHHMM(i.deltaMinutes, true),
      String(isCredit ? minutesToDecimalHours(i.minutes) : -minutesToDecimalHours(i.minutes)).replace('.', ','),
      formatHHMM(i.runningMinutes, true),
      isCredit && i.expiry ? formatDateBR(i.expiry) : '',
      sanitizeCsvCell(i.notes || '')
    ];
  });

  if (includeSummary) {
    const sum = computeExportSummary(chronoEntries);
    const lastRunning = chronoEntries[chronoEntries.length - 1]?.runningMinutes ?? sum.projectedMinutes;
    const balanceNote = sum.realizedMinutes === sum.projectedMinutes
      ? `Saldo: ${formatHHMM(sum.realizedMinutes, true)}`
      : `Realizado: ${formatHHMM(sum.realizedMinutes, true)} | Projetado: ${formatHHMM(sum.projectedMinutes, true)}`;
    rows.push([
      'TOTAL GERAL',
      sanitizeCsvCell(`${sum.count} ${sum.count === 1 ? 'lançamento' : 'lançamentos'}`),
      'Resumo',
      '-',
      '-',
      formatHHMM(sum.workedMinutesTotal, false),
      '-',
      formatHHMM(sum.projectedMinutes, true),
      String(minutesToDecimalHours(sum.projectedMinutes)).replace('.', ','),
      formatHHMM(lastRunning, true),
      '',
      sanitizeCsvCell(balanceNote)
    ]);
  }

  return '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

export function exportCSV(chronoEntries, options = {}) {
  const csv = generateCsvContent(chronoEntries, options);
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
  const hasProjectedDiff = globalSummary.realizedMinutes !== globalSummary.projectedMinutes;
  const hasAnyPlanned = chronoEntries.some((i) => i.status === 'planned');

  const ownerName = sanitizePdfText(settings.userName || opts.userEmail || 'Colaborador');
  const ruleLabel = sanitizePdfText(getActiveRuleSummary(settings));
  const todayIso = getLocalDateISO();
  const holidayMult = Number(settings.holidayMultiplier) || 1.4;
  const overtimeMult = Number(settings.overtimeMultiplier) || 1.5;

  // Cabeçalho executivo branco com barra superior de destaque de ~4px (1.8mm)
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 1.8, 'F');

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(14.5);
  doc.setFont('helvetica', 'bold');
  doc.text(sanitizePdfText('SaldoHoras - Extrato de Banco de Horas & Folgas'), margin, 10.5);

  const metaLine1 = sanitizePdfText(
    `Colaborador: ${ownerName}   |   Regra: ${ruleLabel} (${settings.stateUf || 'SP'})   |   Jornada: ${formatHHMM(settings.dailyMinutes)}/dia`
  );
  const metaLine2 = sanitizePdfText(
    `Escopo: ${opts.scopeLabel}   |   Emissão: ${formatDateBR(todayIso)}`
  );
  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  const wrappedMeta = [
    ...doc.splitTextToSize(metaLine1, pageW - margin * 2),
    ...doc.splitTextToSize(metaLine2, pageW - margin * 2)
  ];
  doc.text(wrappedMeta, margin, 16);

  const dividerY = 16 + wrappedMeta.length * 4 + 1.5;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, dividerY, pageW - margin, dividerY);

  // Cards de resumo sem duplicação (3 cards quando Realizado === Projetado, 4 quando diferem)
  let cursorY = dividerY + 4.5;
  const cards = [
    {
      title: isFilteredRecorte ? 'SALDO ATUAL (CONTA)' : 'SALDO ATUAL DISPONÍVEL',
      value: formatHHMM(globalSummary.realizedMinutes, true),
      sub: `${formatDaysFromMinutes(globalSummary.realizedMinutes, settings.dailyMinutes)} de folga`,
      fill: [240, 253, 244],
      stroke: [187, 247, 208],
      titleColor: [4, 120, 87],
      valueColor: [6, 95, 70]
    },
    ...(hasProjectedDiff
      ? [{
          title: isFilteredRecorte ? 'SALDO PROJETADO (CONTA)' : 'SALDO PROJETADO',
          value: formatHHMM(globalSummary.projectedMinutes, true),
          sub: `${formatDaysFromMinutes(globalSummary.projectedMinutes, settings.dailyMinutes)} c/ previstos`,
          fill: [238, 242, 255],
          stroke: [199, 210, 254],
          titleColor: [67, 56, 202],
          valueColor: [49, 46, 129]
        }]
      : []),
    {
      title: isFilteredRecorte ? 'TOTAL DE CRÉDITOS (RECORTE)' : 'TOTAL DE CRÉDITOS',
      value: formatHHMM(recorteSummary.creditsMinutes, true),
      sub: recorteSummary.bonusMinutes > 0
        ? `sendo +${formatHHMM(recorteSummary.bonusMinutes)} de adicional`
        : `${recorteSummary.creditsCount} ${recorteSummary.creditsCount === 1 ? 'crédito' : 'créditos'}`,
      fill: [248, 250, 252],
      stroke: [203, 213, 225],
      titleColor: [51, 65, 85],
      valueColor: [15, 23, 42]
    },
    {
      title: isFilteredRecorte ? 'FOLGAS NO RECORTE' : 'FOLGAS UTILIZADAS',
      value: formatHHMM(-recorteSummary.debitsMinutes, false),
      sub: `${recorteSummary.debitsCount} ${recorteSummary.debitsCount === 1 ? 'registro' : 'registros'}`,
      fill: [255, 241, 242],
      stroke: [254, 205, 211],
      titleColor: [190, 18, 60],
      valueColor: [159, 18, 57]
    }
  ];

  const cardGap = 3.5;
  const cardW = (pageW - margin * 2 - cardGap * (cards.length - 1)) / cards.length;
  cards.forEach((c, idx) => {
    const x = margin + idx * (cardW + cardGap);
    doc.setFillColor(...c.fill);
    doc.setDrawColor(...c.stroke);
    doc.roundedRect(x, cursorY, cardW, 16.5, 2, 2, 'FD');

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...c.titleColor);
    doc.text(sanitizePdfText(c.title), x + 3, cursorY + 4.5, { maxWidth: cardW - 6 });

    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...c.valueColor);
    doc.text(sanitizePdfText(c.value), x + 3, cursorY + 10.5, { maxWidth: cardW - 6 });

    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(sanitizePdfText(c.sub), x + 3, cursorY + 14.5, { maxWidth: cardW - 6 });
  });
  cursorY += 19.5;

  if (isFilteredRecorte) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(
        `Nota: Recorte filtrado exibe ${chronoEntries.length} de ${globalRows.length} registros (saldo líquido do recorte: ${formatHHMM(recorteSummary.projectedMinutes, true)}). Os saldos acima refletem toda a conta.`
      ),
      margin,
      cursorY
    );
    cursorY += 4.5;
  }

  // Tabela 1 enxuta (7 colunas) com notas discretas sob a descrição e Total Geral no rodapé
  const tableRows = chronoEntries.map((i) => {
    const cleanTitle = sanitizePdfText(formatCleanEntryTitle(i));
    const cleanNote = sanitizePdfText(getCleanEntryNotes(i));
    const descCell = cleanNote ? `${cleanTitle}\nObs.: ${cleanNote}` : cleanTitle;
    return [
      formatDateBR(i.date),
      descCell,
      sanitizePdfText(getEntryTypeDisplayLabel(i, hasAnyPlanned)),
      formatHHMM(i.workedMinutes ?? i.minutes, false),
      formatRuleFactorDisplay(i),
      formatHHMM(i.deltaMinutes, true),
      formatHHMM(i.runningMinutes, true)
    ];
  });

  const lastRunningMinutes = chronoEntries[chronoEntries.length - 1]?.runningMinutes ?? recorteSummary.projectedMinutes;
  const isLandscape = opts.orientation === 'landscape';
  doc.autoTable({
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Data', 'Descrição', 'Tipo', 'Horas', 'Regra', 'Impacto', 'Saldo Acum.']],
    body: tableRows,
    foot: [[
      'TOTAL GERAL',
      `${chronoEntries.length} ${chronoEntries.length === 1 ? 'lançamento' : 'lançamentos'}`,
      '',
      formatHHMM(recorteSummary.workedMinutesTotal, false),
      '-',
      formatHHMM(recorteSummary.projectedMinutes, true),
      formatHHMM(lastRunningMinutes, true)
    ]],
    showFoot: 'lastPage',
    theme: 'grid',
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.25,
      fontStyle: 'bold',
      fontSize: isLandscape ? 8 : 7.2
    },
    bodyStyles: {
      fontSize: isLandscape ? 7.8 : 7,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      cellPadding: 2
    },
    footStyles: {
      fillColor: [238, 242, 255],
      textColor: [15, 23, 42],
      lineColor: [199, 210, 254],
      fontStyle: 'bold',
      fontSize: isLandscape ? 8 : 7.2
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: isLandscape ? 23 : 20 },
      2: { cellWidth: isLandscape ? 38 : 32 },
      3: { halign: 'right', cellWidth: isLandscape ? 19 : 16 },
      4: { halign: 'center', cellWidth: isLandscape ? 16 : 14 },
      5: { halign: 'right', fontStyle: 'bold', cellWidth: isLandscape ? 23 : 20 },
      6: { halign: 'right', fontStyle: 'bold', cellWidth: isLandscape ? 26 : 22 }
    },
    didParseCell(data) {
      if (data.section === 'head' && data.column.index >= 3) {
        data.cell.styles.halign = data.column.index === 4 ? 'center' : 'right';
      } else if (data.section === 'foot' && data.column.index >= 3) {
        data.cell.styles.halign = data.column.index === 4 ? 'center' : 'right';
      } else if (data.section === 'body') {
        const rowItem = chronoEntries[data.row.index];
        if (!rowItem) return;
        if (data.column.index === 5) {
          data.cell.styles.textColor = rowItem.type === 'credit' ? [4, 120, 87] : [190, 18, 60];
        } else if (data.column.index === 2 && rowItem.status === 'planned') {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });

  let nextY = (doc.lastAutoTable?.finalY || cursorY) + 7;

  // Tabela 2: Horas Disponíveis para Folga (Vencem Primeiro)
  if (opts.includeFifo) {
    const analytics = computeAnalyticsSummary(globalRows, opts.remainingMap, settings.dailyMinutes, todayIso);
    if (analytics.openBuckets.length > 0) {
      if (nextY > pageH - 46) {
        doc.addPage();
        nextY = 16;
      }
      doc.setFontSize(9.8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Horas Disponíveis para Folga (Vencem Primeiro)', margin, nextY);
      nextY += 4;
      doc.setFontSize(7.6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('As folgas tiradas abatem automaticamente os créditos que vencem primeiro.', margin, nextY);
      nextY += 2.8;

      const fifoBody = analytics.openBuckets.map((b) => [
        formatDateBR(b.date),
        sanitizePdfText(formatCleanEntryTitle(b)),
        formatHHMM(b.totalMinutes),
        formatHHMM(b.usedMinutes),
        formatHHMM(b.remainingMinutes),
        sanitizePdfText(formatFifoExpiryClean(b))
      ]);
      const fifoInitialSum = analytics.openBuckets.reduce((acc, b) => acc + b.totalMinutes, 0);
      const fifoUsedSum = analytics.openBuckets.reduce((acc, b) => acc + b.usedMinutes, 0);

      doc.autoTable({
        startY: nextY,
        margin: { left: margin, right: margin, bottom: 16 },
        head: [['Data Origem', 'Evento', 'Crédito Inicial', 'Já Usado', 'Disponível', 'Vencimento']],
        body: fifoBody,
        foot: [[
          'TOTAL DISPONÍVEL',
          `${analytics.openBuckets.length} ${analytics.openBuckets.length === 1 ? 'crédito aberto' : 'créditos abertos'}`,
          formatHHMM(fifoInitialSum),
          formatHHMM(fifoUsedSum),
          formatHHMM(analytics.openRemainingMinutes),
          ''
        ]],
        showFoot: 'lastPage',
        theme: 'grid',
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          lineColor: [203, 213, 225],
          lineWidth: 0.25,
          fontStyle: 'bold',
          fontSize: 7.6
        },
        bodyStyles: {
          fontSize: 7.4,
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          cellPadding: 1.8
        },
        footStyles: {
          fillColor: [240, 253, 244],
          textColor: [6, 95, 70],
          lineColor: [187, 247, 208],
          fontStyle: 'bold',
          fontSize: 7.6
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 23 },
          2: { halign: 'right', cellWidth: 25 },
          3: { halign: 'right', cellWidth: 20 },
          4: { halign: 'right', fontStyle: 'bold', cellWidth: 22 },
          5: { cellWidth: isLandscape ? 38 : 28 }
        },
        didParseCell(data) {
          if ((data.section === 'head' || data.section === 'foot') && data.column.index >= 2 && data.column.index <= 4) {
            data.cell.styles.halign = 'right';
          }
        }
      });
      nextY = (doc.lastAutoTable?.finalY || nextY) + 6;
    }
  }

  // Nota rápida sobre regra de multiplicadores + Assinaturas
  if (opts.includeSignatures) {
    if (nextY > pageH - 38) {
      doc.addPage();
      nextY = 20;
    } else {
      nextY += 2;
    }

    doc.setFontSize(7.4);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    const exHoliday = formatHHMM(applyMultiplierToMinutes(480, holidayMult));
    const multText = sanitizePdfText(
      `Regra de conversão: 08:00 em feriado (${holidayMult}x) equivalem a +${exHoliday} no banco de horas; hora extra a ${overtimeMult}x.`
    );
    doc.text(multText, margin, nextY, { maxWidth: pageW - margin * 2 });
    nextY += 6;

    const lineW = (pageW - margin * 2 - 24) / 2;
    const ySig = Math.max(nextY + 8, pageH - 24);

    doc.setDrawColor(148, 163, 184);
    doc.line(margin, ySig, margin + lineW, ySig);
    doc.line(margin + lineW + 24, ySig, margin + lineW * 2 + 24, ySig);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(sanitizePdfText(`${ownerName} (Colaborador)`), margin + lineW / 2, ySig + 4.5, { align: 'center' });
    doc.text('Gestão / Recursos Humanos', margin + lineW + 24 + lineW / 2, ySig + 4.5, { align: 'center' });
  }

  // Rodapé paginado em todas as páginas
  const totalPages = doc.getNumberOfPages();
  const codeNote = opts.integrityCode ? `  |  Cód. Verificação: ${opts.integrityCode}` : '';
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(`Gerado pelo SaldoHoras • Valores em horas:minutos (HH:MM)${codeNote}`), margin, pageH - 6.5);
    doc.text(`Página ${p} de ${totalPages}`, pageW - margin, pageH - 6.5, { align: 'right' });
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

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Bytes(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(dateObj = new Date()) {
  const year = Math.max(1980, dateObj.getFullYear());
  const dosTime = ((dateObj.getHours() & 0x1f) << 11) |
    ((dateObj.getMinutes() & 0x3f) << 5) |
    ((dateObj.getSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) |
    (((dateObj.getMonth() + 1) & 0x0f) << 5) |
    (dateObj.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Monta um arquivo ZIP padrão (STORE com CRC-32 e flag UTF-8) em Uint8Array.
 */
function buildZipArchive(files, now = new Date()) {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = toDosDateTime(now);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32Bytes(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    localChunks.push(local, dataBytes);
    centralChunks.push(central);
    offset += local.length + dataBytes.length;
  }

  const centralSize = centralChunks.reduce((acc, c) => acc + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let ptr = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    out.set(chunk, ptr);
    ptr += chunk.length;
  }
  return out;
}

function xlsxColLetter(indexZero) {
  let n = indexZero + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function xlsxCellXml(ref, spec) {
  const styleIdx = Number.isInteger(spec?.s) ? spec.s : 0;
  const val = spec?.v ?? '';
  if (spec?.type === 'n') {
    const num = Number(val);
    return `<c r="${ref}" s="${styleIdx}"><v>${Number.isFinite(num) ? num : 0}</v></c>`;
  }
  const str = String(val);
  if (!str) {
    return `<c r="${ref}" s="${styleIdx}"/>`;
  }
  return `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(str)}</t></is></c>`;
}

function buildXlsxWorksheetXml(headers, dataRows, minWidths = []) {
  const allRows = [
    headers.map((h) => ({ v: h, s: 1 })),
    ...dataRows
  ];
  const colWidths = headers.map((h, colIdx) => {
    let maxLen = String(h).length;
    for (const row of dataRows) {
      const cell = row[colIdx];
      const text = cell && cell.v !== undefined ? String(cell.v) : '';
      if (text.length > maxLen) maxLen = text.length;
    }
    const minW = minWidths[colIdx] || 11;
    return Math.min(48, Math.max(minW, maxLen + 4));
  });

  const colsXml = colWidths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w.toFixed(1)}" customWidth="1"/>`)
    .join('');

  const sheetRowsXml = allRows
    .map((row, rIdx) => {
      if (!row || row.length === 0) return `<row r="${rIdx + 1}" ht="14" customHeight="1"/>`;
      const rowNum = rIdx + 1;
      const htAttr = rIdx === 0 ? ' ht="24" customHeight="1"' : ' ht="20" customHeight="1"';
      const cellsXml = row
        .map((cell, cIdx) => xlsxCellXml(`${xlsxColLetter(cIdx)}${rowNum}`, cell))
        .join('');
      return `<row r="${rowNum}"${htAttr}>${cellsXml}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`;
}

/**
 * Gera planilha Excel OOXML real (.xlsx) com 2 abas ("Extrato" e "Horas a Vencer"),
 * cabeçalhos congelados, colunas auto-ajustadas e linha de totais.
 */
export function generateExcelXlsxBytes(rows, remainingMap = new Map(), settings = {}, options = {}) {
  const todayIso = getLocalDateISO();
  const globalRows = Array.isArray(options.globalChrono) ? options.globalChrono : rows;
  const recorteSummary = computeExportSummary(rows);
  const globalSummary = computeExportSummary(globalRows);
  const analytics = computeAnalyticsSummary(globalRows, remainingMap, settings.dailyMinutes, todayIso);
  const ownerName = settings.userName || options.userEmail || 'Colaborador';
  const lastRunning = rows[rows.length - 1]?.runningMinutes ?? recorteSummary.projectedMinutes;

  const extractHeaders = [
    'Data',
    'Descrição',
    'Tipo',
    'Status',
    'Horas Trabalhadas',
    'Regra',
    'Impacto (HH:MM)',
    'Impacto Decimal (h)',
    'Saldo Acumulado',
    'Vencimento',
    'Observações'
  ];

  const extractRows = rows.map((i) => {
    const isCredit = i.type === 'credit';
    const dec = isCredit ? minutesToDecimalHours(i.minutes) : -minutesToDecimalHours(i.minutes);
    return [
      { v: formatDateBR(i.date), s: 0 },
      { v: formatCleanEntryTitle(i), s: 0 },
      { v: getEntryTypeDisplayLabel(i, false), s: 0 },
      { v: i.status === 'realized' ? 'Realizado' : 'Previsto', s: 0 },
      { v: formatHHMM(i.workedMinutes ?? i.minutes, false), s: 2 },
      { v: formatRuleFactorDisplay(i), s: 3 },
      { v: formatHHMM(i.deltaMinutes, true), s: isCredit ? 4 : 5 },
      { v: dec, s: 6, type: 'n' },
      { v: formatHHMM(i.runningMinutes, true), s: 2 },
      { v: isCredit && i.expiry ? formatDateBR(i.expiry) : '-', s: 0 },
      { v: i.notes || '', s: 0 }
    ];
  });

  const summaryDiffers = globalSummary.realizedMinutes !== globalSummary.projectedMinutes;
  const balanceNote = summaryDiffers
    ? `Saldo atual: ${formatHHMM(globalSummary.realizedMinutes, true)} | Projetado: ${formatHHMM(globalSummary.projectedMinutes, true)}`
    : `Saldo atual disponível: ${formatHHMM(globalSummary.realizedMinutes, true)}`;

  extractRows.push([
    { v: 'TOTAL GERAL', s: 7 },
    { v: `${rows.length} ${rows.length === 1 ? 'lançamento' : 'lançamentos'}`, s: 7 },
    { v: '', s: 7 },
    { v: '', s: 7 },
    { v: formatHHMM(recorteSummary.workedMinutesTotal, false), s: 8 },
    { v: '-', s: 7 },
    { v: formatHHMM(recorteSummary.projectedMinutes, true), s: 8 },
    { v: minutesToDecimalHours(recorteSummary.projectedMinutes), s: 9, type: 'n' },
    { v: formatHHMM(lastRunning, true), s: 8 },
    { v: '', s: 7 },
    { v: balanceNote, s: 7 }
  ]);

  const fifoHeaders = ['Data Origem', 'Evento', 'Crédito Inicial', 'Já Usado', 'Disponível', 'Vencimento', 'Situação'];
  const fifoRows = analytics.openBuckets.map((b) => {
    const situacao = !b.expiry || !isValidISODate(b.expiry)
      ? 'Sem vencimento'
      : b.badge?.isExpired
        ? 'Vencido'
        : typeof b.badge?.daysRemaining === 'number' && b.badge.daysRemaining <= 60
          ? `Vence em ${b.badge.daysRemaining} dias`
          : 'Prazo longo';
    return [
      { v: formatDateBR(b.date), s: 0 },
      { v: formatCleanEntryTitle(b), s: 0 },
      { v: formatHHMM(b.totalMinutes), s: 2 },
      { v: formatHHMM(b.usedMinutes), s: 2 },
      { v: formatHHMM(b.remainingMinutes), s: 4 },
      { v: b.expiry ? formatDateBR(b.expiry) : '-', s: 0 },
      { v: situacao, s: 0 }
    ];
  });

  const fifoInitialSum = analytics.openBuckets.reduce((acc, b) => acc + b.totalMinutes, 0);
  const fifoUsedSum = analytics.openBuckets.reduce((acc, b) => acc + b.usedMinutes, 0);
  fifoRows.push([
    { v: 'TOTAL DISPONÍVEL', s: 12 },
    { v: `${analytics.openBuckets.length} ${analytics.openBuckets.length === 1 ? 'crédito em aberto' : 'créditos em aberto'}`, s: 12 },
    { v: formatHHMM(fifoInitialSum), s: 10 },
    { v: formatHHMM(fifoUsedSum), s: 10 },
    { v: formatHHMM(analytics.openRemainingMinutes), s: 10 },
    { v: '', s: 12 },
    { v: 'Compensação FIFO', s: 12 }
  ]);
  fifoRows.push([]);
  fifoRows.push([{ v: 'RESUMO DA CONTA', s: 11 }, { v: options.scopeLabel || 'Extrato completo', s: 0 }]);
  fifoRows.push([{ v: 'Colaborador', s: 11 }, { v: ownerName, s: 0 }]);
  fifoRows.push([{ v: 'Regra de Banco', s: 11 }, { v: `${getActiveRuleSummary(settings)} (${settings.stateUf || 'SP'})`, s: 0 }]);
  fifoRows.push([{ v: 'Jornada Diária', s: 11 }, { v: `${formatHHMM(settings.dailyMinutes || 480)}/dia`, s: 0 }]);
  fifoRows.push([{ v: 'Saldo Atual Disponível', s: 11 }, { v: `${formatHHMM(globalSummary.realizedMinutes, true)} (${formatDaysFromMinutes(globalSummary.realizedMinutes, settings.dailyMinutes)})`, s: 4 }]);
  if (summaryDiffers) {
    fifoRows.push([{ v: 'Saldo Projetado', s: 11 }, { v: `${formatHHMM(globalSummary.projectedMinutes, true)} (${formatDaysFromMinutes(globalSummary.projectedMinutes, settings.dailyMinutes)})`, s: 0 }]);
  }
  fifoRows.push([{ v: 'Total de Créditos (Recorte)', s: 11 }, { v: formatHHMM(recorteSummary.creditsMinutes, true), s: 4 }]);
  fifoRows.push([{ v: 'Folgas Utilizadas (Recorte)', s: 11 }, { v: formatHHMM(-recorteSummary.debitsMinutes, false), s: 5 }]);

  const sheet1Xml = buildXlsxWorksheetXml(extractHeaders, extractRows, [13, 28, 20, 12, 18, 10, 16, 18, 17, 14, 24]);
  const sheet2Xml = buildXlsxWorksheetXml(fifoHeaders, fifoRows, [14, 32, 16, 14, 14, 15, 22]);

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF047857"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFBE123C"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF065F46"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF312E81"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="2" fontId="1" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Extrato" sheetId="1" r:id="rId1"/>
    <sheet name="Horas a Vencer" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return buildZipArchive([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
    { name: 'xl/worksheets/sheet2.xml', content: sheet2Xml }
  ]);
}

export function exportExcelXLSX(rows, remainingMap, settings, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Nenhum lançamento encontrado no recorte selecionado para exportar planilha Excel.');
  }
  const bytes = generateExcelXlsxBytes(rows, remainingMap, settings, options);
  triggerDownload(
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `saldohoras-extrato-${getLocalDateISO()}.xlsx`
  );
}

export const exportExcelXML = exportExcelXLSX;

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
  const isFilteredRecorte = Boolean(options.globalChrono && globalRows.length !== rows.length);
  const hasProjectedDiff = globalSummary.realizedMinutes !== globalSummary.projectedMinutes;
  const hasAnyPlanned = rows.some((i) => i.status === 'planned');
  const lastRunningMinutes = rows[rows.length - 1]?.runningMinutes ?? recorteSummary.projectedMinutes;
  const holidayMult = Number(settings.holidayMultiplier) || 1.4;
  const overtimeMult = Number(settings.overtimeMultiplier) || 1.5;

  const tableRowsHtml = rows.map((i) => {
    const isCredit = i.type === 'credit';
    const cleanTitle = formatCleanEntryTitle(i);
    const cleanNote = getCleanEntryNotes(i);
    return `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:5px;">${escapeHtml(formatDateBR(i.date))}</td>
        <td style="border:1px solid #cbd5e1;padding:5px;"><strong>${escapeHtml(cleanTitle)}</strong>${cleanNote ? `<div style="font-size:10px;color:#64748b">Obs.: ${escapeHtml(cleanNote)}</div>` : ''}</td>
        <td style="border:1px solid #cbd5e1;padding:5px;">${escapeHtml(getEntryTypeDisplayLabel(i, hasAnyPlanned))}</td>
        <td style="border:1px solid #cbd5e1;padding:5px;text-align:right;font-family:monospace">${escapeHtml(formatHHMM(i.workedMinutes ?? i.minutes, false))}</td>
        <td style="border:1px solid #cbd5e1;padding:5px;text-align:center">${escapeHtml(formatRuleFactorDisplay(i))}</td>
        <td style="border:1px solid #cbd5e1;padding:5px;text-align:right;font-family:monospace;font-weight:700;color:${isCredit ? '#047857' : '#be123c'}">${escapeHtml(formatHHMM(i.deltaMinutes, true))}</td>
        <td style="border:1px solid #cbd5e1;padding:5px;text-align:right;font-family:monospace;font-weight:700">${escapeHtml(formatHHMM(i.runningMinutes, true))}</td>
      </tr>
    `;
  }).join('');

  const fifoInitialSum = analytics.openBuckets.reduce((acc, b) => acc + b.totalMinutes, 0);
  const fifoUsedSum = analytics.openBuckets.reduce((acc, b) => acc + b.usedMinutes, 0);
  const fifoHtml = options.includeFifo !== false && analytics.openBuckets.length > 0
    ? `
      <h2 style="font-size:13px;font-weight:700;margin:18px 0 2px;color:#0f172a;">Horas Disponíveis para Folga (Vencem Primeiro)</h2>
      <p style="font-size:10.5px;color:#64748b;margin:0 0 6px;">As folgas tiradas abatem automaticamente os créditos que vencem primeiro.</p>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#f1f5f9;color:#0f172a;">
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Data Origem</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Evento</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:right;">Crédito Inicial</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:right;">Já Usado</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:right;">Disponível</th>
            <th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Vencimento</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.openBuckets.map((b) => `
            <tr>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;">${escapeHtml(formatDateBR(b.date))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;">${escapeHtml(formatCleanEntryTitle(b))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(b.totalMinutes))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(b.usedMinutes))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:right;font-family:monospace;font-weight:700;">${escapeHtml(formatHHMM(b.remainingMinutes))}</td>
              <td style="border:1px solid #cbd5e1;padding:4px 6px;">${escapeHtml(formatFifoExpiryClean(b))}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f0fdf4;color:#065f46;font-weight:700;">
            <td style="border:1px solid #cbd5e1;padding:5px 6px;">TOTAL DISPONÍVEL</td>
            <td style="border:1px solid #cbd5e1;padding:5px 6px;">${analytics.openBuckets.length} créditos abertos</td>
            <td style="border:1px solid #cbd5e1;padding:5px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(fifoInitialSum))}</td>
            <td style="border:1px solid #cbd5e1;padding:5px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(fifoUsedSum))}</td>
            <td style="border:1px solid #cbd5e1;padding:5px 6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(analytics.openRemainingMinutes))}</td>
            <td style="border:1px solid #cbd5e1;padding:5px 6px;"></td>
          </tr>
        </tfoot>
      </table>
    `
    : '';

  const exHoliday = formatHHMM(applyMultiplierToMinutes(480, holidayMult));
  const signaturesHtml = options.includeSignatures !== false
    ? `
      <p style="font-size:10px;font-style:italic;color:#64748b;margin:16px 0 0;">Regra de conversão: 08:00 em feriado (${holidayMult}x) equivalem a +${escapeHtml(exHoliday)} no banco de horas; hora extra a ${overtimeMult}x.</p>
      <div style="display:flex;justify-content:space-between;gap:40px;margin-top:30px;">
        <div style="flex:1;border-top:1px solid #64748b;padding-top:6px;text-align:center;font-size:11px;">${escapeHtml(ownerName)} (Colaborador)</div>
        <div style="flex:1;border-top:1px solid #64748b;padding-top:6px;text-align:center;font-size:11px;">Gestão / Recursos Humanos</div>
      </div>
    `
    : '';

  const gridCols = hasProjectedDiff ? 4 : 3;
  containerEl.innerHTML = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a;padding:12px;">
      <div style="border-top:4px solid #4f46e5;padding-top:10px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:12px;">
        <h1 style="font-size:17px;font-weight:800;margin:0;">SaldoHoras — Extrato de Banco de Horas &amp; Folgas</h1>
        <p style="font-size:11px;color:#475569;margin:4px 0 0;">
          <strong>Colaborador:</strong> ${escapeHtml(ownerName)} &bull;
          <strong>Regra:</strong> ${escapeHtml(getActiveRuleSummary(settings))} (${escapeHtml(settings.stateUf || 'SP')}) &bull;
          <strong>Jornada:</strong> ${escapeHtml(formatHHMM(settings.dailyMinutes || 480))}/dia &bull;
          <strong>Escopo:</strong> ${escapeHtml(options.scopeLabel || 'Extrato completo')} &bull;
          <strong>Emissão:</strong> ${escapeHtml(formatDateBR(todayIso))}
        </p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${gridCols},1fr);gap:8px;margin-bottom:12px;font-size:11px;">
        <div style="border:1px solid #bbf7d0;background:#f0fdf4;padding:8px;border-radius:6px;">
          <div style="color:#047857;font-weight:700;font-size:10px;">${isFilteredRecorte ? 'SALDO ATUAL (CONTA)' : 'SALDO ATUAL DISPONÍVEL'}</div>
          <div style="font-size:14px;font-weight:800;font-family:monospace;color:#065f46;">${escapeHtml(formatHHMM(globalSummary.realizedMinutes, true))}</div>
          <div style="font-size:10px;color:#475569;">${escapeHtml(formatDaysFromMinutes(globalSummary.realizedMinutes, settings.dailyMinutes))} de folga</div>
        </div>
        ${hasProjectedDiff ? `
        <div style="border:1px solid #c7d2fe;background:#eef2ff;padding:8px;border-radius:6px;">
          <div style="color:#4338ca;font-weight:700;font-size:10px;">SALDO PROJETADO</div>
          <div style="font-size:14px;font-weight:800;font-family:monospace;color:#312e81;">${escapeHtml(formatHHMM(globalSummary.projectedMinutes, true))}</div>
          <div style="font-size:10px;color:#475569;">${escapeHtml(formatDaysFromMinutes(globalSummary.projectedMinutes, settings.dailyMinutes))} c/ previstos</div>
        </div>` : ''}
        <div style="border:1px solid #cbd5e1;background:#f8fafc;padding:8px;border-radius:6px;">
          <div style="color:#334155;font-weight:700;font-size:10px;">TOTAL DE CRÉDITOS</div>
          <div style="font-size:14px;font-weight:800;font-family:monospace;">${escapeHtml(formatHHMM(recorteSummary.creditsMinutes, true))}</div>
          <div style="font-size:10px;color:#475569;">${recorteSummary.bonusMinutes > 0 ? `sendo +${escapeHtml(formatHHMM(recorteSummary.bonusMinutes))} de adicional` : `${recorteSummary.creditsCount} créditos`}</div>
        </div>
        <div style="border:1px solid #fecdd3;background:#fff1f2;padding:8px;border-radius:6px;">
          <div style="color:#be123c;font-weight:700;font-size:10px;">FOLGAS UTILIZADAS</div>
          <div style="font-size:14px;font-weight:800;font-family:monospace;color:#9f1239;">${escapeHtml(formatHHMM(-recorteSummary.debitsMinutes, false))}</div>
          <div style="font-size:10px;color:#475569;">${recorteSummary.debitsCount} ${recorteSummary.debitsCount === 1 ? 'registro' : 'registros'}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#f1f5f9;color:#0f172a;">
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Data</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Descrição</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left;">Tipo</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right;">Horas</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:center;">Regra</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right;">Impacto</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right;">Saldo Acum.</th>
          </tr>
        </thead>
        <tbody>${tableRowsHtml}</tbody>
        <tfoot>
          <tr style="background:#eef2ff;color:#0f172a;font-weight:700;">
            <td style="border:1px solid #cbd5e1;padding:6px;">TOTAL GERAL</td>
            <td style="border:1px solid #cbd5e1;padding:6px;">${rows.length} ${rows.length === 1 ? 'lançamento' : 'lançamentos'}</td>
            <td style="border:1px solid #cbd5e1;padding:6px;"></td>
            <td style="border:1px solid #cbd5e1;padding:6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(recorteSummary.workedMinutesTotal, false))}</td>
            <td style="border:1px solid #cbd5e1;padding:6px;text-align:center;">-</td>
            <td style="border:1px solid #cbd5e1;padding:6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(recorteSummary.projectedMinutes, true))}</td>
            <td style="border:1px solid #cbd5e1;padding:6px;text-align:right;font-family:monospace;">${escapeHtml(formatHHMM(lastRunningMinutes, true))}</td>
          </tr>
        </tfoot>
      </table>
      ${fifoHtml}
      ${signaturesHtml}
      <p style="font-size:10px;color:#64748b;margin-top:16px;">Gerado pelo SaldoHoras &bull; Valores em horas:minutos (HH:MM)${options.integrityCode ? `  |  Cód. Verificação: ${escapeHtml(options.integrityCode)}` : ''}</p>
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
  const hasProjectedDiff = projectedMins !== realizedMins;
  const plannedDebits = chronoEntries.filter((i) => i.status === 'planned' && i.type === 'debit');
  const senderName = settings.userName || 'Colaborador';
  const ruleLabel = getActiveRuleSummary(settings);

  const hasPlannedDebits = plannedDebits.length > 0;
  const plannedLines = hasPlannedDebits
    ? plannedDebits.map((p) => `• ${formatDateBR(p.date)}: ${p.title} (${formatHHMM(-p.minutes)})`).join('\n')
    : '• Nenhuma folga futura agendada no momento.';

  const emailBalanceLines = hasProjectedDiff
    ? `• Saldo Realizado (disponível hoje): ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})\n` +
      `• Saldo Projetado (considerando agendamentos): ${formatHHMM(projectedMins, true)} (${formatDaysFromMinutes(projectedMins, settings.dailyMinutes)})`
    : `• Saldo atual disponível: ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})`;

  const emailPlannedSection = hasPlannedDebits
    ? `\n\nCompensações / Folgas previstas:\n${plannedLines}`
    : '';

  const emailClosing = hasPlannedDebits
    ? 'Fico à disposição para confirmarmos as datas sem impacto na operação.'
    : 'Segue meu saldo atualizado para conferência.';

  const whatsappBalanceLines = hasProjectedDiff
    ? `✅ *Saldo disponível hoje:* ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})\n` +
      `📅 *Saldo projetado:* ${formatHHMM(projectedMins, true)} (${formatDaysFromMinutes(projectedMins, settings.dailyMinutes)})`
    : `✅ *Saldo atual disponível:* ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})`;

  const whatsappClosing = hasPlannedDebits
    ? `Podemos confirmar essas datas? — _${senderName}_`
    : `Segue meu saldo atualizado para conferência. — _${senderName}_`;

  const emailText =
    `Assunto: Alinhamento de Banco de Horas${hasPlannedDebits ? ' e Folgas Compensatórias' : ''} — ${senderName}

Olá, tudo bem?

Segue o resumo atualizado do meu banco de horas para alinhamento e registro:

${emailBalanceLines}
• Jornada de referência: ${formatHHMM(settings.dailyMinutes)}/dia (${ruleLabel})${emailPlannedSection}

${emailClosing}

Atenciosamente,
${senderName}`;

  const whatsappText =
    `Olá! Tudo certo? Passando para alinhar meu *Banco de Horas*:\n\n` +
    `${whatsappBalanceLines}\n` +
    `⏱️ *Jornada base:* ${formatHHMM(settings.dailyMinutes)}/dia\n\n` +
    `*Folgas previstas:*\n${plannedLines}\n\n` +
    whatsappClosing;

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
    const cleanTitle = formatCleanEntryTitle(item) || 'Lançamento';
    if (item.status === 'planned' && isValidISODate(item.date)) {
      if (item.type === 'debit') {
        const isGenericDebit = /^folga(\s+compensat[oó]ria|\s+solicitada|\s+agendada)?$/i.test(cleanTitle);
        const titlePrefix = isGenericDebit
          ? 'Folga agendada — Banco de Horas'
          : `Folga agendada (${cleanTitle}) — Banco de Horas`;
        events.push({
          uid: `planned-${item.id || item.date}`,
          date: item.date,
          summary: `${titlePrefix} (${formatHHMM(-item.minutes)})`,
          description: `Folga prevista no Banco de Horas • Equivalente a ${formatDaysFromMinutes(item.minutes, dailyMins)}. ${item.notes || ''}`.trim(),
          alarmDaysBefore: 1
        });
      } else {
        events.push({
          uid: `planned-${item.id || item.date}`,
          date: item.date,
          summary: `${cleanTitle} — Banco de Horas (+${formatHHMM(item.minutes)})`,
          description: `Crédito previsto no Banco de Horas • Equivalente a ${formatDaysFromMinutes(item.minutes, dailyMins)}. ${item.notes || ''}`.trim(),
          alarmDaysBefore: 1
        });
      }
    }
    if (item.type === 'credit' && isValidISODate(item.expiry)) {
      const rem = remainingMap.get(item.id) ?? item.minutes;
      if (rem > 0) {
        events.push({
          uid: `expiry-${item.id || item.expiry}`,
          date: item.expiry,
          summary: `Vencimento de ${formatHHMM(rem)} no Banco de Horas (${cleanTitle})`,
          description: `Prazo limite FIFO para compensar ${formatHHMM(rem)} acumulados em ${formatDateBR(item.date)}.`,
          alarmDaysBefore: 15
        });
      }
    }
  }

  return events;
}
