import { ENTRY_CATEGORIES, addDaysToISO, formatDateBR, getLocalDateISO, isValidISODate, sanitizeCsvCell, sanitizePdfText } from './config.js';
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
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
