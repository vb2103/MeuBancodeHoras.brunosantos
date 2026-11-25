import assert from 'node:assert/strict';
import test from 'node:test';
import { addDaysToISO, formatDateBR, getLocalDateISO, isValidISODate, isValidUUID } from '../js/config.js';
import { validateAndNormalizeImportedEntries } from '../js/db.js';
import { computeEasterISO, computeOfflineHolidays, isHolidayAlreadyInEntries } from '../js/holidays.js';
import { findSectorByCode, findUnionByCode } from '../js/rules-catalog.js';
import {
  applyMultiplierToMinutes,
  computeChronologicalAndFIFO,
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
