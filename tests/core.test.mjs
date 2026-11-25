import assert from 'node:assert/strict';
import test from 'node:test';
import { addDaysToISO, formatDateBR, getLocalDateISO, isValidISODate, isValidUUID, sanitizeCsvCell } from '../js/config.js';
import { validateAndNormalizeImportedEntries } from '../js/db.js';
import { buildCalendarEventsFromEntries, generateIcsContent } from '../js/export.js';
import { computeEasterISO, computeOfflineHolidays, getHolidayBridgeOpportunity, isHolidayAlreadyInEntries } from '../js/holidays.js';
import { findSectorByCode, findUnionByCode } from '../js/rules-catalog.js';
import { evaluatePasswordPolicy, formatAuthTimestampBR, getUserInitials } from '../js/security.js';
import {
  applyMultiplierToMinutes,
  computeAnalyticsSummary,
  computeChronologicalAndFIFO,
  computePunchBalance,
  formatDaysFromMinutes,
  formatHHMM,
  getExpiryBadge,
  isHolidayEntry,
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
  assert.match(ics, /DTSTART;VALUE=DATE:20260605/);
  assert.match(ics, /DTEND;VALUE=DATE:20260606/);
  assert.match(ics, /BEGIN:VALARM/);
});
