import { ENTRY_CATEGORIES, formatDateBR, getLocalDateISO, sanitizeCsvCell, sanitizePdfText } from './config.js';
import { getActiveRuleSummary } from './rules-catalog.js';
import { formatDaysFromMinutes, formatHHMM, minutesToDecimalHours } from './time.js';

export function exportCSV(chronoEntries) {
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

  const csv = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saldohoras-extrato-${getLocalDateISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPDF(chronoEntries, settings, userEmail = '', scopeLabel = 'Extrato completo') {
  if (!window.jspdf?.jsPDF) {
    throw new Error('Biblioteca jsPDF indisponível no momento.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const realizedMins = chronoEntries.filter((i) => i.status === 'realized').reduce((s, i) => s + i.deltaMinutes, 0);
  const projectedMins = chronoEntries.reduce((s, i) => s + i.deltaMinutes, 0);
  const ownerName = sanitizePdfText(settings.userName || userEmail || 'Colaborador');
  const ruleLabel = sanitizePdfText(getActiveRuleSummary(settings));

  doc.setFillColor(30, 27, 75);
  doc.rect(0, 0, 297, 29, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SaldoHoras - Extrato de Banco de Horas & Folgas', 14, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Colaborador: ${ownerName}  |  Regra: ${ruleLabel} (${settings.stateUf || 'SP'})  |  Jornada: ${formatHHMM(settings.dailyMinutes)}/dia  |  ${sanitizePdfText(scopeLabel)}  |  Emitido: ${new Date().toLocaleDateString('pt-BR')}`,
    14,
    21
  );

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Saldo Realizado: ${formatHHMM(realizedMins, true)} (${formatDaysFromMinutes(realizedMins, settings.dailyMinutes)})    |    Saldo Projetado: ${formatHHMM(projectedMins, true)} (${formatDaysFromMinutes(projectedMins, settings.dailyMinutes)})`,
    14,
    38
  );

  const tableRows = chronoEntries.map((i) => [
    formatDateBR(i.date),
    sanitizePdfText(i.title),
    i.status === 'realized' ? 'Realizado' : 'Previsto',
    i.type === 'credit' && Number(i.multiplier) !== 1 ? `${i.multiplier}x` : '1.0x',
    formatHHMM(i.deltaMinutes, true),
    formatHHMM(i.runningMinutes, true),
    i.expiry ? formatDateBR(i.expiry) : '-',
    sanitizePdfText(i.notes || '')
  ]);

  doc.autoTable({
    startY: 43,
    head: [['Data', 'Evento / Descrição', 'Status', 'Fator', 'Horas (HH:MM)', 'Saldo Acum.', 'Vencimento', 'Observações']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 23 },
      2: { cellWidth: 21 },
      3: { halign: 'center', cellWidth: 15 },
      4: { halign: 'right', cellWidth: 25 },
      5: { halign: 'right', cellWidth: 24 },
      6: { cellWidth: 23 }
    }
  });

  const safeSlug = ownerName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  doc.save(`SaldoHoras_${safeSlug}_${getLocalDateISO()}.pdf`);
}

export function exportJSONBackup(settings, entries) {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    entries
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saldohoras-backup-${getLocalDateISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
