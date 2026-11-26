import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { APP_PUBLIC_URL, APP_VERSION, STORAGE_KEYS, addDaysToISO, escapeXml, formatDateBR, getAppRedirectUrl, getLocalDateISO, isValidISODate, isValidUUID, sanitizeCsvCell, sanitizePdfText } from '../js/config.js';
import {
  clearClientUserStorage,
  clearPendingRulePreset,
  collectUserStorageKeysToClear,
  formatPendingLogoutWarning,
  loadPendingRulePreset,
  parseAndCleanAppLaunchUrl,
  parseAndCleanShortcutUrl,
  savePendingRulePreset
} from '../js/pwa.js';
import { submitFeedbackToCloud, validateAndNormalizeImportedEntries } from '../js/db.js';
import {
  buildCalendarEventsFromEntries,
  buildCommunicationTemplates,
  computeExportSummary,
  computeIntegrityDigest,
  exportCSV,
  exportPDF,
  generateCsvContent,
  generateExcelXlsxBytes,
  generateIcsContent,
  generateStructuredXml
} from '../js/export.js';
import { computeEasterISO, computeOfflineHolidays, getHolidayBridgeOpportunity, isHolidayAlreadyInEntries } from '../js/holidays.js';
import { findSectorByCode, findUnionByCode } from '../js/rules-catalog.js';
import { evaluatePasswordPolicy, formatAuthTimestampBR, getUserInitials, mapAuthErrorMessage } from '../js/security.js';
import {
  clearGuestState,
  computeGuestMigrationPlan,
  createDemoEntries,
  isGuestModeActive,
  loadGuestState,
  mergeGuestWithCloudEntries,
  partitionGuestEntries,
  saveGuestState,
  setGuestModeActive
} from '../js/guest.js';
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
} from '../js/sync-queue.js';
import { prefersReducedMotion, readCssMs } from '../js/ui-motion.js';
import { PINNED_VENDORS } from '../js/vendor-loader.js';
import { computeCycleCarryOver, mergeArchivedCycles } from '../js/cycles.js';
import {
  applyMultiplierToMinutes,
  buildExpiryAlertSummary,
  computeAnalyticsSummary,
  computeChronologicalAndFIFO,
  computePunchBalance,
  formatDaysFromMinutes,
  formatHHMM,
  formatUrgentExpiryCardNote,
  getExpiryBadge,
  isHolidayEntry,
  isInitialBalanceEntry,
  isWriteOffEntry,
  maskPrivacyDays,
  maskPrivacyHours,
  parseDurationToMinutes
} from '../js/time.js';

test('parseDurationToMinutes aceita HH:MM, decimal, XhYY e minutos', () => {
  assert.equal(parseDurationToMinutes('08:00'), 480);
  assert.equal(parseDurationToMinutes('1:30'), 90);
  assert.equal(parseDurationToMinutes('1,5'), 90);
  assert.equal(parseDurationToMinutes('1.5h'), 90);
  assert.equal(parseDurationToMinutes('8h48'), 528);
  assert.equal(parseDurationToMinutes('45m'), 45);
  assert.equal(parseDurationToMinutes('08:75'), null);
  assert.equal(parseDurationToMinutes('-01:00'), null);
  assert.equal(parseDurationToMinutes('00:00'), null);
});

test('formatHHMM e formatDaysFromMinutes calculam exatamente em minutos inteiros', () => {
  assert.equal(formatHHMM(90, true), '+01:30');
  assert.equal(formatHHMM(-90, true), '-01:30');
  assert.equal(formatHHMM(0, true), '00:00');
  assert.equal(formatHHMM(528, false), '08:48');
  assert.equal(formatDaysFromMinutes(240, 480), '0,5 dias');
  assert.equal(formatDaysFromMinutes(720, 480), '1,5 dias');
  assert.equal(applyMultiplierToMinutes(480, 1.5), 720);
  const partialExp = getExpiryBadge('2026-12-31', 240, '2026-11-24', 672);
  assert.match(partialExp.label, /resta 04:00/);
});

test('utilitários de data local evitam desvio UTC', () => {
  const lateNightBRT = new Date(2026, 10, 24, 23, 45, 0); // 24/11/2026 23:45 local
  assert.equal(getLocalDateISO(lateNightBRT), '2026-11-24');
  assert.equal(addDaysToISO('2026-11-24', 10), '2026-12-04');
  assert.equal(formatDateBR('2026-11-24'), '24/11/2026');
  assert.equal(isValidISODate('2026-02-30'), false);
});

test('computeChronologicalAndFIFO ordena deterministicamente e abate créditos por FIFO', () => {
  const sample = [
    { id: 'b', date: '2026-02-01', type: 'debit', minutes: 480, status: 'realized', createdAt: '2026-02-01T10:00:00Z' },
    { id: 'a', date: '2026-01-01', type: 'credit', minutes: 480, status: 'realized', expiry: '2026-06-30', category: 'holiday', title: 'Confraternização', createdAt: '2026-01-01T10:00:00Z' },
    { id: 'c', date: '2026-05-01', type: 'credit', minutes: 240, status: 'planned', expiry: '2026-12-01', category: 'overtime', title: 'Plantão Extra', createdAt: '2026-05-01T10:00:00Z' }
  ];

  const result = computeChronologicalAndFIFO(sample, '2026-11-24');
  assert.equal(result.summary.realizedMinutes, 0);
  assert.equal(result.summary.projectedMinutes, 240);
  // O crédito de 01/01 (480m) foi totalmente compensado pelo débito de 01/02 (480m), não deve gerar alerta de vencido
  assert.equal(result.remainingMap.get('a'), 0);
  assert.equal(result.remainingMap.get('c'), 240);
  assert.equal(result.urgentItems.length, 1);
  assert.equal(result.urgentItems[0].id, 'c');
  assert.equal(getExpiryBadge('2026-06-30', 0, '2026-11-24').isAlert, false);
});

test('isHolidayEntry diferencia feriados de horas extras comuns', () => {
  assert.equal(isHolidayEntry({ type: 'credit', category: 'holiday', title: 'Plantão' }), true);
  assert.equal(isHolidayEntry({ type: 'credit', category: 'overtime', title: 'Deploy noturno' }), false);
  assert.equal(isHolidayEntry({ type: 'credit', category: 'manual', title: 'Tiradentes' }), true);
});

test('catálogo de sindicatos e ramos cobre perfis principais e regra Sindpd-SP 1.4x (+40%)', () => {
  const sindpd = findUnionByCode('sindpd_sp');
  assert.equal(sindpd?.dailyMinutes, 480);
  assert.equal(sindpd?.holidayMultiplier, 1.4);
  assert.equal(findUnionByCode('ti_sindpd')?.overtimeMultiplier, 1.5);
  assert.equal(findUnionByCode('ti_sindpd')?.holidayMultiplier, 1.4);
  assert.equal(findSectorByCode('tecnologia')?.holidayMultiplier, 1.4);
  assert.equal(findSectorByCode('financeiro')?.dailyMinutes, 360);

  // 01:00 trabalhada em feriado Sindpd-SP = 01:24 no banco (84 min)
  const oneHourHoliday = applyMultiplierToMinutes(60, sindpd.holidayMultiplier);
  assert.equal(oneHourHoliday, 84);
  assert.equal(formatHHMM(oneHourHoliday, true), '+01:24');

  // 08:00 trabalhadas em feriado Sindpd-SP = 11:12 no banco (672 min)
  const fullDayHoliday = applyMultiplierToMinutes(480, sindpd.holidayMultiplier);
  assert.equal(fullDayHoliday, 672);
  assert.equal(formatHHMM(fullDayHoliday, true), '+11:12');
});

test('calendário offline de feriados calcula Páscoa e feriados por ano/UF corretamente', () => {
  assert.equal(computeEasterISO(2026), '2026-04-05');
  assert.equal(computeEasterISO(2027), '2027-03-28');

  const sp2026 = computeOfflineHolidays(2026, 'SP');
  assert.ok(sp2026.some((h) => h.date === '2026-02-17' && h.name === 'Carnaval'));
  assert.ok(sp2026.some((h) => h.date === '2026-06-04' && h.name === 'Corpus Christi'));
  assert.ok(sp2026.some((h) => h.date === '2026-07-09' && h.scope === 'SP'));

  const already = isHolidayAlreadyInEntries(
    [{ date: '2026-07-09', type: 'credit', category: 'holiday', title: 'Revolução Constitucionalista' }],
    '2026-07-09',
    'Revolução Constitucionalista de 1932 (SP)'
  );
  assert.equal(already, true);
});

test('validateAndNormalizeImportedEntries valida campos e corrige IDs não-UUID', () => {
  const { validEntries, skippedCount } = validateAndNormalizeImportedEntries([
    { id: '123', date: '2026-04-21', title: 'Tiradentes', type: 'credit', hours: 8, status: 'realized' },
    { id: 'invalid', date: '2026-99-99', title: 'Ruim', type: 'credit', hours: 4 },
    { date: '2026-05-01', title: 'Folga', type: 'debit', minutes: 90, status: 'planned' }
  ]);

  assert.equal(validEntries.length, 2);
  assert.equal(skippedCount, 1);
  assert.equal(isValidUUID(validEntries[0].id), true);
  assert.equal(validEntries[0].minutes, 480);
  assert.equal(validEntries[1].minutes, 90);
});

test('política de senha segura e helpers de perfil/segurança validam corretamente', () => {
  const shortPwd = evaluatePasswordPolicy('Ab1!');
  assert.equal(shortPwd.valid, false);
  assert.equal(shortPwd.checks.minLength, false);

  const commonPwd = evaluatePasswordPolicy('Password123', { email: 'alice@empresa.com' });
  const containsEmail = evaluatePasswordPolicy('Alice2026!', { email: 'alice@empresa.com' });
  assert.equal(commonPwd.valid, false);
  assert.equal(containsEmail.valid, false);
  assert.equal(containsEmail.checks.notTrivial, false);

  const sameAsCurrent = evaluatePasswordPolicy('Forte#2026', {
    email: 'bruno@empresa.com',
    currentPassword: 'Forte#2026'
  });
  assert.equal(sameAsCurrent.valid, false);
  assert.equal(sameAsCurrent.checks.differsFromCurrent, false);

  const strongPwd = evaluatePasswordPolicy('Banco#2026!Hora', {
    email: 'bruno@empresa.com',
    currentPassword: 'Antiga#2025'
  });
  assert.equal(strongPwd.valid, true);
  assert.ok(strongPwd.score >= 3);

  assert.equal(getUserInitials('Vítor Bruno Santos', 'v@b.com'), 'VS');
  assert.equal(getUserInitials('', 'bruno@empresa.com'), 'BR');
  assert.notEqual(formatAuthTimestampBR('2026-11-25T03:00:00Z'), '—');
});

test('sanitizeCsvCell neutraliza CSV formula injection', () => {
  assert.equal(sanitizeCsvCell('=CMD()'), '"\'=CMD()"');
  assert.equal(sanitizeCsvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(sanitizeCsvCell('Tiradentes "SP"'), '"Tiradentes ""SP"""');
});

test('computeAnalyticsSummary resume bônus de multiplicadores, série mensal e buckets FIFO', () => {
  const sample = [
    { id: '1', date: '2026-09-07', title: 'Independência', type: 'credit', category: 'holiday', workedMinutes: 480, minutes: 672, multiplier: 1.4, status: 'realized', expiry: '2027-03-06' },
    { id: '2', date: '2026-09-20', title: 'Plantão Domingo', type: 'credit', category: 'overtime', workedMinutes: 240, minutes: 360, multiplier: 1.5, status: 'realized', expiry: '2027-03-19' },
    { id: '3', date: '2026-10-05', title: 'Folga Parcial', type: 'debit', category: 'time_off', workedMinutes: 240, minutes: 240, multiplier: 1.0, status: 'realized', expiry: '' }
  ];
  const { chrono, remainingMap } = computeChronologicalAndFIFO(sample, '2026-11-25');
  const summary = computeAnalyticsSummary(chrono, remainingMap, 480, '2026-11-25');

  assert.equal(summary.workedMinutesTotal, 720);
  assert.equal(summary.creditedMinutesTotal, 1032);
  assert.equal(summary.bonusMinutes, 312); // (672-480) + (360-240)
  assert.equal(summary.compensatedMinutes, 240);
  assert.equal(summary.openRemainingMinutes, 792);
  assert.equal(summary.monthlySeries.length, 2);
  assert.equal(summary.monthlySeries[0].label, 'Set/26');
  assert.equal(summary.monthlySeries[0].netMinutes, 1032);
  assert.equal(summary.monthlySeries[1].label, 'Out/26');
  assert.equal(summary.monthlySeries[1].debitsMinutes, 240);
  assert.equal(summary.openBuckets[0].remainingMinutes, 432); // 672 - 240 FIFO
});

test('computePunchBalance calcula saldo pelo ponto e turnos sem intervalo', () => {
  const overtime = computePunchBalance({
    entryTime: '08:00',
    breakStart: '12:00',
    breakEnd: '13:00',
    exitTime: '18:30',
    dailyMinutes: 480,
    compareWithJourney: true
  });
  assert.equal(overtime.workedMinutes, 570);
  assert.equal(overtime.diffMinutes, 90);
  assert.equal(overtime.suggestedType, 'credit');
  assert.equal(overtime.durationMinutes, 90);

  const earlyOut = computePunchBalance({
    entryTime: '08:00',
    breakStart: '12:00',
    breakEnd: '13:00',
    exitTime: '16:00',
    dailyMinutes: 480,
    compareWithJourney: true
  });
  assert.equal(earlyOut.diffMinutes, -60);
  assert.equal(earlyOut.suggestedType, 'debit');
  assert.equal(earlyOut.durationMinutes, 60);

  const holidayStraight = computePunchBalance({
    entryTime: '09:00',
    exitTime: '15:00',
    dailyMinutes: 480,
    compareWithJourney: false
  });
  assert.equal(holidayStraight.workedMinutes, 360);
  assert.equal(holidayStraight.durationMinutes, 360);
});

test('getHolidayBridgeOpportunity detecta pontes de terça/quinta e gera eventos ICS válidos', () => {
  // 2026-04-21 é terça-feira (Tiradentes) -> ponte 2026-04-20 (segunda)
  const tueBridge = getHolidayBridgeOpportunity({ date: '2026-04-21', name: 'Tiradentes' }, []);
  assert.equal(tueBridge.bridgeDate, '2026-04-20');
  assert.equal(tueBridge.bridgeLabel, 'Ponte na Segunda');

  // 2026-06-04 é quinta-feira (Corpus Christi) -> ponte 2026-06-05 (sexta)
  const thuBridge = getHolidayBridgeOpportunity({ date: '2026-06-04', name: 'Corpus Christi' }, []);
  assert.equal(thuBridge.bridgeDate, '2026-06-05');
  assert.equal(thuBridge.bridgeLabel, 'Ponte na Sexta');

  // 2026-09-07 é segunda-feira -> sem ponte
  assert.equal(getHolidayBridgeOpportunity({ date: '2026-09-07', name: 'Independência' }, []), null);

  const events = buildCalendarEventsFromEntries(
    [{ id: 'a1', date: '2026-06-05', title: 'Folga Ponte', type: 'debit', minutes: 480, status: 'planned', notes: 'Emenda' }],
    new Map(),
    { dailyMinutes: 480 }
  );
  const ics = generateIcsContent(events, new Date('2026-11-25T12:00:00Z'));
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /Folga agendada \(Folga Ponte\) — Banco de Horas \(-08:00\)/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260605/);
  assert.match(ics, /DTEND;VALUE=DATE:20260606/);
  assert.match(ics, /BEGIN:VALARM/);

  const expEvents = buildCalendarEventsFromEntries(
    [{ id: 'c1', date: '2026-11-15', title: 'Proclamação (Plantão/Feriado)', category: 'holiday', type: 'credit', minutes: 672, expiry: '2027-05-14', status: 'realized' }],
    new Map([['c1', 384]]),
    { dailyMinutes: 480 }
  );
  assert.equal(expEvents[0].summary, 'Vencimento de 06:24 no Banco de Horas (Proclamação)');
  assert.equal(expEvents[0].alarmDaysBefore, 15);
});

test('XML estruturado, Excel OOXML (.xlsx), CSV acentuado, sanitização PDF e digest SHA-256 funcionam', async () => {
  assert.equal(escapeXml('A & B <tag> "x" \'y\''), 'A &amp; B &lt;tag&gt; &quot;x&quot; &apos;y&apos;');
  assert.equal(sanitizePdfText('Ponto 08:00 → +01:00 ≈ 0,1d — ✓'), 'Ponto 08:00 -> +01:00 ~ 0,1d - OK');

  const sample = [
    { id: '1', date: '2026-09-07', title: 'Feriado & Plantão (Plantão/Feriado)', type: 'credit', category: 'holiday', workedMinutes: 480, minutes: 672, multiplier: 1.4, status: 'realized', expiry: '2027-03-06', notes: '<obs>' },
    { id: '2', date: '2026-10-05', title: 'Folga Compensatória', type: 'debit', category: 'time_off', workedMinutes: 480, minutes: 480, multiplier: 1.0, status: 'planned', expiry: '', notes: '' }
  ];
  const { chrono, remainingMap } = computeChronologicalAndFIFO(sample, '2026-11-25');
  const settings = { userName: 'Vitor Bruno', stateUf: 'SP', dailyMinutes: 480, holidayMultiplier: 1.4, overtimeMultiplier: 1.5, expiryDays: 180, unionMode: 'union', unionCode: 'sindpd_sp' };
  const digest = await computeIntegrityDigest(chrono, settings, 'Extrato completo');
  assert.match(digest, /^SH-[0-9A-F]{12}$/);

  const sum = computeExportSummary(chrono);
  assert.equal(sum.bonusMinutes, 192);
  assert.equal(sum.projectedMinutes, 192);

  const xml = generateStructuredXml(chrono, remainingMap, settings, { integrityCode: digest, globalChrono: chrono, userEmail: 'v@teste.com' });
  assert.match(xml, /<bancoHoras versao="1\.0"/);
  assert.match(xml, /codigoVerificacao="SH-/);
  assert.match(xml, /Feriado &amp; Plantão/);
  assert.match(xml, /&lt;obs&gt;/);

  const xlsxBytes = generateExcelXlsxBytes(chrono, remainingMap, settings, { globalChrono: chrono });
  assert.ok(xlsxBytes instanceof Uint8Array);
  assert.equal(xlsxBytes[0], 0x50);
  assert.equal(xlsxBytes[1], 0x4b);
  assert.equal(xlsxBytes[2], 0x03);
  assert.equal(xlsxBytes[3], 0x04);
  const xlsxText = new TextDecoder('utf-8').decode(xlsxBytes);
  assert.match(xlsxText, /\[Content_Types\]\.xml/);
  assert.match(xlsxText, /xl\/workbook\.xml/);
  assert.match(xlsxText, /xl\/styles\.xml/);
  assert.match(xlsxText, /xl\/worksheets\/sheet1\.xml/);
  assert.match(xlsxText, /xl\/worksheets\/sheet2\.xml/);
  assert.match(xlsxText, /name="Extrato"/);
  assert.match(xlsxText, /name="Horas a Vencer"/);
  assert.match(xlsxText, /state="frozen"/);
  assert.match(xlsxText, /customWidth="1"/);
  assert.match(xlsxText, /Descrição/);
  assert.match(xlsxText, /Crédito Inicial/);
  assert.match(xlsxText, /TOTAL GERAL/);
  assert.match(xlsxText, /TOTAL DISPONÍVEL/);

  const csv = generateCsvContent(chrono, { includeSummary: true });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /^﻿Data;Descrição;Categoria;Tipo;Status;Horas Trabalhadas \(HH:MM\);Regra;/);
  assert.match(csv, /;Crédito;Realizado;/);
  assert.match(csv, /;Débito;Previsto;/);
  assert.match(csv, /TOTAL GERAL;/);

  assert.throws(() => exportCSV([]), /Nenhum lançamento encontrado/);
  assert.throws(() => exportPDF([], settings), /Nenhum lançamento encontrado/);
});

test('filtros rápidos de extrato e detecção de duplicidades operam com precisão', () => {
  const entries = [
    { id: '1', date: '2026-11-02', title: 'Finados', type: 'credit', minutes: 672, status: 'realized', category: 'holiday' },
    { id: '2', date: '2026-11-15', title: 'Proclamação', type: 'credit', minutes: 672, status: 'planned', category: 'holiday' },
    { id: '3', date: '2026-11-20', title: 'Folga Compensatória', type: 'debit', minutes: 480, status: 'realized', category: 'time_off' },
    { id: '4', date: '2026-12-25', title: 'Natal', type: 'credit', minutes: 672, status: 'planned', category: 'holiday' }
  ];

  // Filtro credits
  const credits = entries.filter((e) => e.type === 'credit');
  assert.equal(credits.length, 3);

  // Filtro debits
  const debits = entries.filter((e) => e.type === 'debit');
  assert.equal(debits.length, 1);
  assert.equal(debits[0].id, '3');

  // Filtro thismonth (2026-11)
  const novemberEntries = entries.filter((e) => e.date.startsWith('2026-11'));
  assert.equal(novemberEntries.length, 3);

  // Detecção de duplicidade: mesma data e mesmo título (case-insensitive)
  const isDuplicateExact = entries.some(
    (e) => e.id !== 'new-id' && e.date === '2026-11-02' && e.title.trim().toLowerCase() === 'finados'
  );
  assert.equal(isDuplicateExact, true);

  const isDuplicateDifferentDate = entries.some(
    (e) => e.id !== 'new-id' && e.date === '2026-11-03' && e.title.trim().toLowerCase() === 'finados'
  );
  assert.equal(isDuplicateDifferentDate, false);

  // Em edição, o próprio registro não deve acusar duplicidade consigo mesmo
  const isDuplicateSelf = entries.some(
    (e) => e.id !== '1' && e.date === '2026-11-02' && e.title.trim().toLowerCase() === 'finados'
  );
  assert.equal(isDuplicateSelf, false);
});

test('buildExpiryAlertSummary e formatUrgentExpiryCardNote exibem mensagens exatas e linha condicional sem falsos positivos', () => {
  // 1) Somente expirado parcial (576 min = 09:36 de 672 min)
  const sample = [
    { id: 'c1', date: '2026-04-01', title: 'Sexta-feira Santa', type: 'credit', minutes: 672, status: 'realized', expiry: '2026-10-03' },
    { id: 'd1', date: '2026-05-01', title: 'Saída', type: 'debit', minutes: 96, status: 'realized' },
    { id: 'c2', date: '2026-09-07', title: 'Independência', type: 'credit', minutes: 672, status: 'realized', expiry: '2027-06-01' }
  ];
  const { chrono, remainingMap, urgentItems, summary } = computeChronologicalAndFIFO(sample, '2026-11-26');
  const alertObj = buildExpiryAlertSummary(urgentItems, { isFilteredExpiring: false, summaryProjectedMinutes: summary.projectedMinutes });
  assert.equal(alertObj.text, '09:36 expirados (1 item)');
  assert.equal(alertObj.actionLabel, 'Ver ›');
  assert.equal(alertObj.tone, 'expired');

  const filteredObj = buildExpiryAlertSummary(urgentItems, { isFilteredExpiring: true, summaryProjectedMinutes: summary.projectedMinutes });
  assert.equal(filteredObj.actionLabel, 'Mostrar todos ×');
  assert.equal(filteredObj.tone, 'filtered');

  // Card 1 parcial expirado -> 3a linha mostra Restam 09:36 • Venceu em 03/10/2026
  const c1Note = formatUrgentExpiryCardNote(chrono[0], remainingMap.get('c1'), '2026-11-26');
  assert.equal(c1Note.text, 'Restam 09:36 • Venceu em 03/10/2026');
  assert.equal(c1Note.isExpired, true);

  // Card 2 no prazo longo -> null (mantém card compacto de 2 linhas)
  const c2Note = formatUrgentExpiryCardNote(chrono[2], remainingMap.get('c2'), '2026-11-26');
  assert.equal(c2Note, null);

  // 2) Valor igual ao original expirando em breve
  const soonItem = { id: 's1', date: '2026-06-01', title: 'Corpus Christi', type: 'credit', minutes: 672, status: 'realized', expiry: '2026-12-15' };
  const soonState = computeChronologicalAndFIFO([soonItem], '2026-11-26');
  const soonAlert = buildExpiryAlertSummary(soonState.urgentItems, { summaryProjectedMinutes: soonState.summary.projectedMinutes });
  assert.equal(soonAlert.text, '11:12 vencem em 19 dias');
  assert.equal(soonAlert.tone, 'warning');
  const soonCard = formatUrgentExpiryCardNote(soonState.chrono[0], 672, '2026-11-26');
  assert.equal(soonCard.text, 'Vence em 15/12/2026');
  assert.equal(soonCard.isExpired, false);

  // 3) Sem alerta quando saldo líquido <= 0 ou lista vazia
  assert.equal(buildExpiryAlertSummary([], { summaryProjectedMinutes: 600 }), null);
  assert.equal(buildExpiryAlertSummary(urgentItems, { summaryProjectedMinutes: 0 }), null);
});

test('buildCommunicationTemplates adapta saldo, bloco de folgas e fechamento conforme agendamentos', () => {
  const settings = {
    userName: 'Vitor Bruno',
    dailyMinutes: 480,
    holidayMultiplier: 1.4,
    overtimeMultiplier: 1.5,
    expiryDays: 180,
    unionMode: 'union',
    unionCode: 'sindpd_sp'
  };

  const withoutPlanned = computeChronologicalAndFIFO([
    { id: '1', date: '2026-09-07', title: 'Independência', type: 'credit', minutes: 672, status: 'realized' },
    { id: '2', date: '2026-11-26', title: 'Folga Compensatória', type: 'debit', minutes: 480, status: 'realized' }
  ]).chrono;

  const tplNoPlanned = buildCommunicationTemplates(withoutPlanned, settings);
  // Saldo igual -> não duplica saldo nem exibe bloco vazio de folgas no E-mail Formal
  assert.match(tplNoPlanned.emailText, /• Saldo atual disponível: \+03:12/);
  assert.doesNotMatch(tplNoPlanned.emailText, /Saldo Projetado \(considerando agendamentos\)/);
  assert.doesNotMatch(tplNoPlanned.emailText, /Compensações \/ Folgas previstas/);
  assert.doesNotMatch(tplNoPlanned.emailText, /Nenhuma folga futura agendada/);
  assert.match(tplNoPlanned.emailText, /Segue meu saldo atualizado para conferência\./);
  assert.doesNotMatch(tplNoPlanned.emailText, /confirmarmos as datas/);

  assert.match(tplNoPlanned.whatsappText, /\*Saldo atual disponível:\* \+03:12/);
  assert.doesNotMatch(tplNoPlanned.whatsappText, /\*Saldo projetado:\*/);
  assert.match(tplNoPlanned.whatsappText, /Segue meu saldo atualizado para conferência\. — _Vitor Bruno_$/);
  assert.doesNotMatch(tplNoPlanned.whatsappText, /Podemos confirmar essas datas\?/);

  const withPlanned = computeChronologicalAndFIFO([
    { id: '1', date: '2026-09-07', title: 'Independência', type: 'credit', minutes: 672, status: 'realized' },
    { id: '2', date: '2026-12-04', title: 'Folga Ponte', type: 'debit', minutes: 480, status: 'planned' }
  ]).chrono;

  const tplWithPlanned = buildCommunicationTemplates(withPlanned, settings);
  assert.match(tplWithPlanned.emailText, /Saldo Realizado \(disponível hoje\): \+11:12/);
  assert.match(tplWithPlanned.emailText, /Saldo Projetado \(considerando agendamentos\): \+03:12/);
  assert.match(tplWithPlanned.emailText, /Compensações \/ Folgas previstas:\n• 04\/12\/2026: Folga Ponte/);
  assert.match(tplWithPlanned.emailText, /confirmarmos as datas/);

  assert.match(tplWithPlanned.whatsappText, /\*Saldo disponível hoje:\* \+11:12/);
  assert.match(tplWithPlanned.whatsappText, /\*Saldo projetado:\* \+03:12/);
  assert.match(tplWithPlanned.whatsappText, /04\/12\/2026: Folga Ponte/);
  assert.match(tplWithPlanned.whatsappText, /Podemos confirmar essas datas\? — _Vitor Bruno_$/);
});

test('ponto noturno (cruzando meia-noite), breakMinutes, privacidade e lançamentos especiais', () => {
  const nightWithBreak = computePunchBalance({
    entryTime: '22:00',
    exitTime: '06:00',
    breakMinutes: 60,
    dailyMinutes: 480
  });
  assert.equal(nightWithBreak.crossesMidnight, true);
  assert.equal(nightWithBreak.workedMinutes, 420);
  assert.equal(nightWithBreak.durationMinutes, 420);

  const nightNoBreak = computePunchBalance({
    entryTime: '22:00',
    exitTime: '02:30',
    breakMinutes: 0
  });
  assert.equal(nightNoBreak.crossesMidnight, true);
  assert.equal(nightNoBreak.workedMinutes, 270);

  assert.equal(maskPrivacyHours('+08:00'), '+••:••');
  assert.equal(maskPrivacyHours('-01:30'), '-••:••');
  assert.equal(maskPrivacyHours('00:00'), '••:••');
  assert.equal(maskPrivacyDays('-1,5 dias'), '-•• dias');
  assert.equal(maskPrivacyDays('3,2 dias', true), '•• dias de folga');

  assert.equal(isInitialBalanceEntry({ category: 'adjustment', title: 'Saldo inicial informado' }), true);
  assert.equal(isInitialBalanceEntry({ category: 'adjustment', title: 'Outro ajuste' }), false);
  assert.equal(isWriteOffEntry({ category: 'adjustment', title: 'Baixa por vencimento — Feriado' }), true);
  assert.equal(isWriteOffEntry({ category: 'adjustment', title: 'Fechamento de ciclo — Plantão' }), true);
  assert.equal(isWriteOffEntry({ category: 'overtime', title: 'Baixa por vencimento — Teste' }), false);
});

test('fila offline (sync-queue.js) mescla operações, aplica estado e persiste cache/onboarding', () => {
  let queue = [];
  queue = enqueueSyncOp(queue, { kind: 'settings', settings: { dailyMinutes: 480 } });
  queue = enqueueSyncOp(queue, { kind: 'settings', settings: { dailyMinutes: 440 } });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].settings.dailyMinutes, 440);

  queue = enqueueSyncOp(queue, { kind: 'upsert', entry: { id: 'e1', title: 'Plantão', minutes: 120, type: 'credit', status: 'realized', date: '2026-11-26' } });
  queue = enqueueSyncOp(queue, { kind: 'upsert', entry: { id: 'e2', title: 'Folga', minutes: 60, type: 'debit', status: 'realized', date: '2026-11-26' } });
  queue = enqueueSyncOp(queue, { kind: 'delete', id: 'e1' });
  assert.equal(queue.length, 3); // settings + upsert(e2) + delete(e1)

  const baseState = {
    settings: { dailyMinutes: 480, stateUf: 'SP' },
    entries: [{ id: 'e1', title: 'Plantão', minutes: 120, type: 'credit', status: 'realized', date: '2026-11-26' }]
  };
  const merged = applyQueueToState(baseState, queue);
  assert.equal(merged.settings.dailyMinutes, 440);
  assert.equal(merged.settings.stateUf, 'SP');
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].id, 'e2');

  // Estado original permanece intacto
  assert.equal(baseState.entries.length, 1);
  assert.equal(baseState.entries[0].id, 'e1');

  assert.equal(isLikelyNetworkError(new Error('Failed to fetch')), true);
  assert.equal(isLikelyNetworkError(new Error('Invalid JWT')), false);

  const memStore = new Map();
  const mockStorage = {
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)),
    removeItem: (k) => memStore.delete(k)
  };

  saveUserCache('u1', merged, mockStorage);
  assert.equal(loadUserCache('u1', mockStorage)?.entries?.length, 1);
  saveSyncQueue('u1', queue, mockStorage);
  assert.equal(loadSyncQueue('u1', mockStorage).length, 3);
  saveSyncQueue('u1', [], mockStorage);
  assert.equal(loadSyncQueue('u1', mockStorage).length, 0);

  assert.equal(hasCompletedOnboarding('u1', mockStorage), false);
  markOnboardingCompleted('u1', mockStorage);
  assert.equal(hasCompletedOnboarding('u1', mockStorage), true);
});

test('dependências CDN v25 têm versão fixa, SRI SHA-384 e helpers de motion seguros em Node', () => {
  const vendors = Object.values(PINNED_VENDORS);
  assert.equal(vendors.length, 5);
  for (const v of vendors) {
    assert.match(v.url, /^https:\/\/.*@\d+\.\d+\.\d+\/|\/\d+\.\d+\.\d+\//);
    assert.match(v.integrity, /^sha384-[A-Za-z0-9+/=]{60,}$/);
  }
  assert.equal(prefersReducedMotion(), false);
  assert.equal(readCssMs('--modal-open-dur', 250), 250);
});

test('computeCycleCarryOver preserva créditos em aberto por FIFO com vencimentos originais, saldo negativo e modo zerado', () => {
  const settings = { dailyMinutes: 480, unionMode: 'union', unionCode: 'sindpd_sp', stateUf: 'SP' };
  const sampleEntries = [
    { id: 'c1', date: '2026-08-01', type: 'credit', minutes: 480, category: 'holiday', title: 'Feriado Agosto', status: 'realized', expiry: '2027-01-28', createdAt: '2026-08-01T10:00:00Z' },
    { id: 'd1', date: '2026-09-10', type: 'debit', minutes: 240, category: 'time_off', title: 'Meia Folga', status: 'realized', createdAt: '2026-09-10T10:00:00Z' },
    { id: 'c2', date: '2026-10-12', type: 'credit', minutes: 672, category: 'holiday', title: 'Feriado Outubro', status: 'realized', expiry: '2027-04-10', createdAt: '2026-10-12T10:00:00Z' }
  ];

  // Cenário 1: Continuar com minhas horas (+15:12 = 240 + 672)
  const carryRes = computeCycleCarryOver(sampleEntries, settings, { mode: 'carry', cycleName: 'Ciclo 2026', closingDate: '2026-11-26' });
  assert.equal(carryRes.archivedCycle.name, 'Ciclo 2026');
  assert.equal(carryRes.archivedCycle.finalBalanceMinutes, 912);
  assert.equal(carryRes.archivedCycle.entriesCount, 3);
  assert.equal(carryRes.nextEntries.length, 2);
  assert.equal(carryRes.nextEntries[0].minutes, 240);
  assert.equal(carryRes.nextEntries[0].expiry, '2027-01-28');
  assert.equal(carryRes.nextEntries[0].notes, 'Do ciclo anterior');
  assert.equal(carryRes.nextEntries[1].minutes, 672);
  assert.equal(carryRes.nextEntries[1].expiry, '2027-04-10');

  // Cenário 2: Começar zerado
  const zeroRes = computeCycleCarryOver(sampleEntries, settings, { mode: 'zero', cycleName: 'Empresa Antiga', closingDate: '2026-11-26' });
  assert.equal(zeroRes.nextEntries.length, 0);
  assert.equal(zeroRes.archivedCycle.finalBalanceMinutes, 912);

  // Cenário 3: Saldo negativo transportado
  const negEntries = [{ id: 'n1', date: '2026-11-20', type: 'debit', minutes: 180, category: 'time_off', title: 'Consulta', status: 'realized' }];
  const negRes = computeCycleCarryOver(negEntries, settings, { mode: 'carry', closingDate: '2026-11-26' });
  assert.equal(negRes.nextEntries.length, 1);
  assert.equal(negRes.nextEntries[0].type, 'debit');
  assert.equal(negRes.nextEntries[0].minutes, 180);
  assert.equal(negRes.nextEntries[0].title, 'Saldo anterior (-03:00)');

  // Cenário 4: Fluxo 3 folgas independentes -> exclusão de 1 -> recálculo FIFO e exportação Excel do ciclo arquivado
  const multiLeaves = ['2026-11-16', '2026-11-17', '2026-11-19'].map((d, idx) => ({
    id: `leave-${idx}`,
    date: d,
    type: 'debit',
    minutes: 480,
    category: 'time_off',
    title: 'Folga Compensatória',
    status: 'realized'
  }));
  const with3 = computeChronologicalAndFIFO([sampleEntries[0], ...multiLeaves], '2026-11-26');
  assert.equal(with3.summary.debitsCount, 3);
  assert.equal(with3.summary.realizedMinutes, -960);

  const afterDel1 = computeChronologicalAndFIFO([sampleEntries[0], multiLeaves[0], multiLeaves[2]], '2026-11-26');
  assert.equal(afterDel1.summary.debitsCount, 2);
  assert.equal(afterDel1.summary.realizedMinutes, -480);

  const mergedCycles = mergeArchivedCycles([carryRes.archivedCycle], [carryRes.archivedCycle, zeroRes.archivedCycle]);
  assert.equal(mergedCycles.length, 2);
  const xlsxArchived = generateExcelXlsxBytes(carryRes.archivedCycle.entries, new Map(), settings, {
    scopeLabel: `Arquivo: ${carryRes.archivedCycle.name}`
  });
  assert.equal(xlsxArchived[0], 0x50); // PK zip header
});

test('modo teste local (guest), exemplos isDemo, migração inteligente e erros auth em PT-BR', () => {
  // 1. Erros Supabase nunca vazam em inglês
  assert.match(mapAuthErrorMessage({ message: 'Invalid login credentials' }), /incorretos/);
  assert.match(mapAuthErrorMessage({ message: 'Email not confirmed' }), /confirmado/);
  assert.match(mapAuthErrorMessage({ message: 'User already registered' }), /Já existe/);
  assert.match(mapAuthErrorMessage({ message: 'Unable to validate email address: invalid format' }), /e-mail válido/);
  assert.match(mapAuthErrorMessage({ message: 'Some unknown English error' }), /Não foi possível/);

  // 2. Storage isolado do modo teste + persistência entre recargas
  const store = new Map();
  const mockStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  setGuestModeActive(true, mockStorage);
  assert.equal(isGuestModeActive(mockStorage), true);

  const demoList = createDemoEntries({ dailyMinutes: 480, overtimeMultiplier: 1.5, holidayMultiplier: 1.4, expiryDays: 180 }, '2026-11-26');
  assert.equal(demoList.length, 5);
  assert.equal(demoList.every((e) => e.isDemo === true), true);
  assert.equal(partitionGuestEntries(demoList).hasOnlyDemo, true);

  // Cenário A: só exemplos -> migração silenciosa
  assert.equal(computeGuestMigrationPlan({ guestEntries: demoList, cloudEntries: [] }).action, 'silent');

  // Cenário B: 2 lançamentos reais -> prompt para conta nova com contagem e saldo exatos
  const realEntries = [
    { id: 'r1', date: '2026-11-10', type: 'credit', minutes: 240, title: 'Extra', status: 'realized' },
    { id: 'r2', date: '2026-11-12', type: 'debit', minutes: 60, title: 'Saída', status: 'realized' }
  ];
  saveGuestState({ settings: { dailyMinutes: 440 }, entries: [...demoList, ...realEntries] }, mockStorage);
  assert.equal(loadGuestState(mockStorage).entries.length, 7);

  const newAccPlan = computeGuestMigrationPlan({ guestEntries: [...demoList, ...realEntries], cloudEntries: [], isNewAccount: true });
  assert.equal(newAccPlan.action, 'new_account_prompt');
  assert.equal(newAccPlan.realEntries.length, 2);
  assert.equal(newAccPlan.balanceMinutes, 180);

  // Cenário C: conta existente com 1 duplicado -> mescla evitando duplicata
  const cloudExisting = [{ id: 'cloud-1', date: '2026-11-10', type: 'credit', minutes: 240, title: 'Extra', status: 'realized' }];
  const mergePlan = computeGuestMigrationPlan({ guestEntries: realEntries, cloudEntries: cloudExisting, isNewAccount: false });
  assert.equal(mergePlan.action, 'merge_prompt');
  const toInsert = mergeGuestWithCloudEntries(cloudExisting, mergePlan.realEntries);
  assert.equal(toInsert.length, 1);
  assert.equal(toInsert[0].id, 'r2');

  clearGuestState(mockStorage);
  assert.equal(isGuestModeActive(mockStorage), false);
});

test('PWA offline: sw.js, manifest shortcuts, limpeza de sessão no logout e RLS estrito', async () => {
  const swSource = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const manifestJson = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const rlsSql = fs.readFileSync(new URL('../supabase/migrations/004_archived_cycles_and_strict_rls.sql', import.meta.url), 'utf8');

  // 1. Versão sincronizada entre config.js e sw.js + estrutura de cache segura
  assert.match(swSource, new RegExp(`const APP_VERSION = '${APP_VERSION.replace(/\./g, '\\.')}'`));
  assert.match(swSource, /const CACHE_NAME = `saldohoras-static-\$\{APP_VERSION\}`/);
  assert.match(swSource, /'\.\/js\/pwa\.js'/);
  assert.match(swSource, /type === 'SKIP_WAITING'/);
  assert.doesNotMatch(swSource, /skipWaiting\(\);\s*\}\);\s*self\.addEventListener\('activate'/);
  assert.match(swSource, /k !== CACHE_NAME && \(k\.startsWith\('saldohoras-static-'\) \|\| k\.startsWith\('saldohoras-shell-'\)\)/);
  assert.match(swSource, /if \(request\.method !== 'GET'\) return;/);

  // 2. Manifest start_url e shortcuts com caminhos relativos apontando para app.html
  assert.equal(manifestJson.start_url, './app.html');
  assert.equal(manifestJson.scope, './');
  assert.ok(Array.isArray(manifestJson.shortcuts));
  assert.deepEqual(
    manifestJson.shortcuts.map((s) => ({ name: s.name, url: s.url })),
    [
      { name: '+ Ganhei Horas', url: './app.html?atalho=ganho' },
      { name: '- Tirei Folga', url: './app.html?atalho=folga' }
    ]
  );

  // 3. Parser e limpeza de parâmetro ?atalho= na URL
  assert.deepEqual(parseAndCleanShortcutUrl('https://vb2103.github.io/MeuBancodeHoras.brunosantos/?atalho=ganho'), {
    shortcut: 'ganho',
    cleanUrl: '/MeuBancodeHoras.brunosantos/',
    hadParam: true
  });
  assert.deepEqual(parseAndCleanShortcutUrl('https://vb2103.github.io/?atalho=FOLGA&aba=extrato#topo'), {
    shortcut: 'folga',
    cleanUrl: '/?aba=extrato#topo',
    hadParam: true
  });
  assert.deepEqual(parseAndCleanShortcutUrl('https://vb2103.github.io/?atalho=invalido'), {
    shortcut: null,
    cleanUrl: '/',
    hadParam: true
  });
  assert.deepEqual(parseAndCleanShortcutUrl('https://vb2103.github.io/'), {
    shortcut: null,
    cleanUrl: '/',
    hadParam: false
  });

  // 4. Mensagem de proteção contra perda de alterações offline no logout
  assert.match(formatPendingLogoutWarning(1), /1 alteração ainda não enviada para a nuvem.*ela será perdida/);
  assert.match(formatPendingLogoutWarning(3), /3 alterações ainda não enviadas para a nuvem.*elas serão perdidas/);

  // 5. Higiene total de sessão em localStorage/sessionStorage e IndexedDB no logout
  const createMockWebStorage = (initialEntries) => {
    const map = new Map(Object.entries(initialEntries));
    return {
      get length() { return map.size; },
      key: (i) => Array.from(map.keys())[i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      _map: map
    };
  };

  const mockLocal = createMockWebStorage({
    [STORAGE_KEYS.THEME]: 'dark',
    [STORAGE_KEYS.PRIVACY]: '1',
    [STORAGE_KEYS.HOLIDAY_UF]: 'RJ',
    [`${STORAGE_KEYS.CACHE_PREFIX}user-a`]: '{"entries":[1]}',
    [`${STORAGE_KEYS.QUEUE_PREFIX}user-a`]: '[{"kind":"upsert"}]',
    [`${STORAGE_KEYS.CYCLES_PREFIX}user-a`]: '[{"id":"c1"}]',
    [`${STORAGE_KEYS.ONBOARDING_PREFIX}user-a`]: '1',
    [STORAGE_KEYS.GUEST_STATE]: '{"entries":[]}',
    'sb-opctsxkugbljvghcgnvj-auth-token': '{"access_token":"secret"}',
    'saldohoras_draft_entry': '{"title":"rascunho"}'
  });
  const mockSession = createMockWebStorage({
    'sb-opctsxkugbljvghcgnvj-code-verifier': 'xyz'
  });
  const deletedIdbs = [];
  const mockIdb = {
    databases: async () => [{ name: 'saldohoras_local' }, { name: 'supabase_session' }],
    deleteDatabase: (name) => {
      deletedIdbs.push(name);
      const req = {};
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }
  };

  assert.equal(collectUserStorageKeysToClear(mockLocal).includes(STORAGE_KEYS.THEME), false);
  const cleanupRes = await clearClientUserStorage({ local: mockLocal, session: mockSession, idb: mockIdb });
  assert.equal(mockLocal.getItem(STORAGE_KEYS.THEME), 'dark');
  assert.equal(mockLocal.length, 1); // Somente o tema do aparelho permanece
  assert.equal(mockSession.length, 0);
  assert.equal(cleanupRes.removedLocal, 9);
  assert.equal(deletedIdbs.includes('saldohoras_local'), true);
  assert.equal(deletedIdbs.includes('supabase_session'), true);

  // 6. Auditoria SQL RLS (004)
  assert.match(rlsSql, /ADD COLUMN IF NOT EXISTS archived_cycles jsonb/);
  assert.match(rlsSql, /ALTER TABLE public\.bh_params FORCE ROW LEVEL SECURITY/);
  assert.match(rlsSql, /ALTER TABLE public\.bh_entries FORCE ROW LEVEL SECURITY/);
  assert.match(rlsSql, /bh_params_owner_select[\s\S]*FOR SELECT/);
  assert.match(rlsSql, /bh_params_owner_insert[\s\S]*FOR INSERT/);
  assert.match(rlsSql, /bh_params_owner_update[\s\S]*FOR UPDATE/);
  assert.match(rlsSql, /bh_params_owner_delete[\s\S]*FOR DELETE/);
  assert.match(rlsSql, /bh_entries_owner_select[\s\S]*FOR SELECT/);
  assert.match(rlsSql, /bh_entries_owner_delete[\s\S]*FOR DELETE/);
});

test('Open Graph 1200x630, Desktop 1120px/modais 480px, FAQ 5 itens, Feedback e Compartilhar', async () => {
  const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const landingHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
  const feedbackSql = fs.readFileSync(new URL('../supabase/migrations/005_user_feedback.sql', import.meta.url), 'utf8');
  const ogPng = fs.readFileSync(new URL('../assets/og-cover.png', import.meta.url));

  // 1. assets/og-cover.png 1200x630 real + meta tags absolutas https:// na Landing Page e no App
  assert.equal(ogPng.readUInt32BE(16), 1200);
  assert.equal(ogPng.readUInt32BE(20), 630);
  assert.equal(APP_PUBLIC_URL, 'https://vb2103.github.io/MeuBancodeHoras.brunosantos/');
  assert.match(landingHtml, /property="og:image" content="https:\/\/vb2103\.github\.io\/MeuBancodeHoras\.brunosantos\/assets\/og-cover\.png"/);
  assert.match(landingHtml, /property="og:image:secure_url" content="https:\/\/vb2103\.github\.io\/MeuBancodeHoras\.brunosantos\/assets\/og-cover\.png"/);
  assert.match(landingHtml, /property="og:image:width" content="1200"/);
  assert.match(landingHtml, /property="og:image:height" content="630"/);
  assert.match(landingHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(landingHtml, /name="twitter:image" content="https:\/\/vb2103\.github\.io\/MeuBancodeHoras\.brunosantos\/assets\/og-cover\.png"/);
  assert.match(html, /property="og:image" content="https:\/\/vb2103\.github\.io\/MeuBancodeHoras\.brunosantos\/assets\/og-cover\.png"/);

  // 2. Desktop layout 1120px, 2 colunas, modal centralizado 480px e navegação no header
  assert.match(css, /@media \(min-width: 768px\)[\s\S]*max-width: 480px !important/);
  assert.match(css, /@media \(min-width: 1024px\)[\s\S]*max-width: 1120px !important/);
  assert.match(css, /38fr[\s\S]*62fr/);
  assert.match(html, /id="desktopHeaderNav"/);
  assert.match(html, /id="desktopNavBtn-extrato"/);
  assert.match(html, /id="desktopNavHolidaysBtn"/);
  assert.match(html, /id="desktopNavBtn-graficos"/);
  assert.match(html, /id="desktopNavBtn-comunicacao"/);

  // 3. FAQ 5 dúvidas + canal feedback + botão compartilhar no menu Perfil
  assert.match(html, /id="openHelpFeedbackBtn"/);
  assert.match(html, /id="shareAppMenuBtn"/);
  assert.match(html, /id="faqAccBody5"/);
  assert.match(html, /id="feedbackForm"/);
  await assert.rejects(() => submitFeedbackToCloud({ message: 'cur' }), /5 caracteres/);

  // 4. SQL feedback com RLS INSERT-only
  assert.match(feedbackSql, /CREATE TABLE IF NOT EXISTS public\.bh_feedback/);
  assert.match(feedbackSql, /FORCE ROW LEVEL SECURITY/);
  assert.match(feedbackSql, /GRANT INSERT ON TABLE public\.bh_feedback TO anon, authenticated/);
});

test('iOS PWA standalone: safe-area-inset-top sem corte, header auto, h-14 interno e botão perfil w-10 h-10 shrink-0', () => {
  const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');

  // 1. Meta tags obrigatórias para notch / status bar iOS standalone
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/);
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.json" \/>/);

  // 2. <header> sem h-14/h-16 direta; altura fixa apenas no container flex interno e botão w-10 h-10 shrink-0
  const headerTagMatch = html.match(/<header\b[^>]*>/);
  assert.ok(headerTagMatch, '<header> deve existir no HTML');
  assert.doesNotMatch(headerTagMatch[0], /\bh-1[46]\b/);
  assert.match(headerTagMatch[0], /\bsh-app-header\b/);
  assert.match(html, /<div class="sh-header-inner [^"]*\bh-14 md:h-16\b/);
  assert.match(html, /id="userMenuBtn"[^>]*\bw-10 h-10 shrink-0\b/);

  // 3. CSS mobile + @media (display-mode: standalone): height auto + safe-area + sem blur + compensação do <main>
  assert.match(css, /\.sh-app-header\s*\{[\s\S]*?height:\s*auto\s*!important;[\s\S]*?padding-top:\s*env\(safe-area-inset-top\)\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important;/);
  assert.match(css, /@media \(display-mode:\s*standalone\)[\s\S]*?\.sh-app-header\s*\{[\s\S]*?height:\s*auto\s*!important;[\s\S]*?padding-top:\s*env\(safe-area-inset-top\)\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;/);
  assert.match(css, /\.sh-main\s*\{[\s\S]*?padding-top:\s*calc\(3\.5rem \+ env\(safe-area-inset-top\)/);

  // 4. Desktop (>= 768px) preservado com inner h-16 (4rem), botão Perfil expandido e privacidade 36x36 (w-9 h-9)
  assert.match(css, /@media \(min-width:\s*768px\)[\s\S]*?\.sh-header-inner\s*\{\s*height:\s*4rem;/);
  assert.match(css, /@media \(min-width:\s*768px\)[\s\S]*?\.sh-app-header \.sh-user-menu-btn\s*\{/);
  const privacyBtnMatch = html.match(/<button\b[^>]*id="desktopPrivacyToggleBtn"[^>]*>/);
  assert.ok(privacyBtnMatch, '#desktopPrivacyToggleBtn deve existir no HTML');
  assert.match(privacyBtnMatch[0], /\bw-9 h-9\b/);
  assert.doesNotMatch(privacyBtnMatch[0], /\bsh-touch-44\b/);
});

test('Landing page (index.html), rotas app.html (?mode=, ?preset=), redirectTo Supabase e Service Worker dual', () => {
  const landingHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const swSource = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const authSource = fs.readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
  const profileSource = fs.readFileSync(new URL('../js/profile.js', import.meta.url), 'utf8');

  // 1. Links e seções essenciais na Landing Page
  assert.match(landingHtml, /href="app\.html\?mode=login"/);
  assert.match(landingHtml, /href="app\.html\?mode=signup"/);
  assert.match(landingHtml, /id="demo-union"/);
  assert.match(landingHtml, /id="preview-device-mobile"/);
  assert.match(landingHtml, /id="preview-device-desktop"/);
  assert.match(landingHtml, /id="desktop-mock-eye-btn"/);
  assert.match(landingHtml, /web-mock-filter/);
  assert.match(landingHtml, /Ir para o Painel/);
  assert.match(landingHtml, /sb\.auth\.getSession/);

  // 2. Parser de parâmetros (?mode=, ?preset=, ?h=, ?m=, ?atalho=) preservando PKCE ?code=
  const signupWithPreset = parseAndCleanAppLaunchUrl(
    'https://vb2103.github.io/MeuBancodeHoras.brunosantos/app.html?mode=signup&preset=industria&h=8&m=48&code=pkce-123'
  );
  assert.equal(signupWithPreset.mode, 'signup');
  assert.equal(signupWithPreset.preset?.unionCode, 'metalurgicos');
  assert.equal(signupWithPreset.hours, 8);
  assert.equal(signupWithPreset.minutes, 48);
  assert.equal(signupWithPreset.cleanUrl, '/MeuBancodeHoras.brunosantos/app.html?code=pkce-123');

  const loginLaunch = parseAndCleanAppLaunchUrl('https://vb2103.github.io/MeuBancodeHoras.brunosantos/app.html?mode=login');
  assert.equal(loginLaunch.mode, 'login');
  assert.equal(loginLaunch.cleanUrl, '/MeuBancodeHoras.brunosantos/app.html');

  // 3. Persistência temporária em sessionStorage do preset do simulador
  const mockSessionStorage = (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k)
    };
  })();
  assert.equal(savePendingRulePreset(signupWithPreset, mockSessionStorage), true);
  assert.equal(loadPendingRulePreset(mockSessionStorage)?.unionCode, 'metalurgicos');
  clearPendingRulePreset(mockSessionStorage);
  assert.equal(loadPendingRulePreset(mockSessionStorage), null);

  // 4. redirectTo / emailRedirectTo sempre apontando para URL completa de app.html
  assert.equal(
    getAppRedirectUrl('https://vb2103.github.io/MeuBancodeHoras.brunosantos/app.html?mode=signup'),
    'https://vb2103.github.io/MeuBancodeHoras.brunosantos/app.html'
  );
  assert.equal(
    getAppRedirectUrl('https://vb2103.github.io/MeuBancodeHoras.brunosantos/'),
    'https://vb2103.github.io/MeuBancodeHoras.brunosantos/app.html'
  );
  assert.match(authSource, /getAppRedirectUrl\(/);
  assert.match(profileSource, /getAppRedirectUrl\(/);

  // 5. sw.js inclui landing + app.html + assets/og-cover.png e distingue rota app.html no fallback offline
  assert.match(swSource, /'\.\/app\.html'/);
  assert.match(swSource, /'\.\/index\.html'/);
  assert.match(swSource, /'\.\/assets\/og-cover\.png'/);
  assert.match(swSource, /isAppRoute/);
});
