import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseToday, addDays, validateStay, calendarOffset, calendarMonths } from '../app/booking-utils.ts';

test('house date follows London time, including summer midnight', () => {
  assert.equal(houseToday(new Date('2026-07-10T23:30:00Z')), '2026-07-11');
  assert.equal(houseToday(new Date('2026-12-10T23:30:00Z')), '2026-12-10');
});
test('date arithmetic crosses month, year, leap day and DST boundaries', () => {
  assert.equal(addDays('2026-12-31', 2), '2027-01-02');
  assert.equal(addDays('2028-02-28', 2), '2028-03-01');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
});
test('a valid future stay and a same-day arrival are accepted', () => {
  assert.equal(validateStay('2026-10-05', '2026-10-07', '2', '2026-10-04'), null);
  assert.equal(validateStay('2026-10-04', '2026-10-05', '41', '2026-10-04'), null);
});
test('invalid, missing and impossible calendar dates are rejected', () => {
  for (const date of ['', 'bad', '2026-02-30', '2026-13-01', '2026-1-1']) {
    assert.ok(validateStay(date, '2026-11-01', '1', '2026-10-04'));
    assert.ok(validateStay('2026-10-05', date, '1', '2026-10-04'));
  }
});
test('past arrival and zero or negative nights are rejected', () => {
  assert.match(validateStay('2026-10-03', '2026-10-07', '1', '2026-10-04'), /past/);
  for (const departure of ['2026-10-05', '2026-10-04']) assert.match(validateStay('2026-10-05', departure, '1', '2026-10-04'), /after/);
});
test('guest count must be an integer within existing API limits', () => {
  for (const count of ['', '0', '-1', '42', '2.5', '1e1', 'NaN', ' ']) {
    assert.match(validateStay('2026-10-05', '2026-10-07', count, '2026-10-04'), /whole number/);
  }
});
test('calendar starts on the correct Monday-first weekday', () => {
  assert.equal(calendarOffset('2026-10-04'), 6);
  assert.equal(calendarOffset('2026-10-05'), 0);
  assert.equal(calendarOffset('2026-10-31'), 5);
});
test('calendar separates months and preserves availability', () => {
  const days = [{ date: '2026-10-31', free_rooms: 3 }, { date: '2026-11-01', free_rooms: 0 }];
  const months = calendarMonths(days);
  assert.deepEqual(months.map(m => m.title), ['October 2026', 'November 2026']);
  assert.deepEqual(months.map(m => m.days[0]), days);
  assert.deepEqual(calendarMonths([]), []);
});
