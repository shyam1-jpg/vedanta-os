import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_ROOM_FILTERS, filterRooms, roomOptions, roomSelection, roomRequestText, toggleComparison } from '../app/room-options.ts';

const rooms = [
  { number: '10', section: 'First Floor', type_name: 'Twin room', sleeps: 2, beds: '2 single', feature_labels: ['Lake view', 'Shower'], accessible: false },
  { number: '2', section: 'Ground Floor', type_name: 'Double room', sleeps: 2, beds: '1 double', feature_labels: ['Desk'], accessible: false },
  { number: 'G03', section: 'Ground Floor', type_name: 'Twin room', sleeps: 3, beds: '2 single · 1 extra mattress', feature_labels: ['Accessible'], accessible: true },
  { number: '201', section: null, type_name: 'Single room', sleeps: 1, beds: '', feature_labels: [], accessible: false },
];
const filtered = overrides => filterRooms(rooms, { ...EMPTY_ROOM_FILTERS, ...overrides }, 4);
test('rooms for a large party remain visible so they can be combined', () => {
  assert.equal(filtered({}).length, 4);
  assert.equal(filtered({ fitsParty: true }).length, 0);
});
test('bed filter uses the actual room setup, not an aggregated type', () => {
  assert.deepEqual(filtered({ bed: 'double' }).map(r => r.number), ['2']);
  assert.equal(filtered({ bed: 'king' }).length, 0);
});
test('room type, area, feature and accessibility filters intersect', () => {
  assert.deepEqual(filtered({ type: 'Twin room', section: 'Ground Floor', accessible: true }).map(r => r.number), ['G03']);
  assert.equal(filtered({ accessible: true, feature: 'Lake view' }).length, 0);
  assert.deepEqual(filtered({ feature: 'Shower' }).map(r => r.number), ['10']);
});
test('missing location or amenities do not create false feature matches', () => {
  assert.equal(filtered({ section: 'Second Floor' }).length, 0);
  assert.equal(filtered({ feature: 'En suite' }).length, 0);
});
test('room ordering is numeric and does not mutate the API response', () => {
  assert.deepEqual(filtered({}).map(r => r.number), ['2', '10', '201', 'G03']);
  assert.deepEqual(rooms.map(r => r.number), ['10', '2', 'G03', '201']);
});
test('sort by capacity in either direction', () => {
  assert.equal(filterRooms(rooms, EMPTY_ROOM_FILTERS, 1, 'capacity-asc')[0].number, '201');
  assert.equal(filterRooms(rooms, EMPTY_ROOM_FILTERS, 1, 'capacity-desc')[0].number, 'G03');
});
test('one-room fit filter uses the current guest count', () => {
  assert.deepEqual(filterRooms(rooms, { ...EMPTY_ROOM_FILTERS, fitsParty: true }, 3).map(r => r.number), ['G03']);
});
test('empty choice cannot continue', () => {
  assert.equal(roomSelection(rooms, [], 2).canContinue, false);
  assert.equal(roomSelection(rooms, [], 2).remaining, 2);
});
test('combining rooms adds capacity and permits a full-party enquiry', () => {
  const result = roomSelection(rooms, ['2', 'G03'], 5);
  assert.equal(result.capacity, 5);
  assert.equal(result.remaining, 0);
  assert.equal(result.canContinue, true);
});
test('insufficient capacity cannot advance and states the shortfall', () => {
  const result = roomSelection(rooms, ['201'], 4);
  assert.equal(result.remaining, 3);
  assert.equal(result.canContinue, false);
});
test('duplicate choices and unknown rooms cannot inflate capacity', () => {
  const result = roomSelection(rooms, ['2', '2', 'unknown'], 3);
  assert.equal(result.chosen.length, 1);
  assert.equal(result.capacity, 2);
  assert.equal(result.canContinue, false);
});
test('a fresh search dropping a selected room removes its capacity', () => {
  const result = roomSelection(rooms.filter(r => r.number !== 'G03'), ['2', 'G03'], 5);
  assert.equal(result.capacity, 2);
  assert.equal(result.canContinue, false);
});
test('invalid guest counts do not pass selection validation', () => {
  for (const guests of [0, -1, NaN, 1.5]) assert.equal(roomSelection(rooms, ['2'], guests).canContinue, false);
});
test('request contains room identifiers without claiming a reservation', () => {
  assert.equal(roomRequestText([]), '');
  const text = roomRequestText(roomSelection(rooms, ['2', 'G03'], 4).chosen);
  assert.match(text, /subject to house confirmation/);
  assert.match(text, /2 — Double room; G03 — Twin room/);
});
test('filter choices are deduplicated and omit unknown locations', () => {
  assert.deepEqual(roomOptions(rooms, 'section'), ['First Floor', 'Ground Floor']);
  assert.deepEqual(roomOptions(rooms, 'type_name'), ['Double room', 'Single room', 'Twin room']);
  assert.deepEqual(roomOptions([], 'feature_labels'), []);
});
test('comparison is capped at three and removing one allows a new choice', () => {
  assert.deepEqual(toggleComparison(['2', '10', 'G03'], '201'), ['2', '10', 'G03']);
  assert.deepEqual(toggleComparison(['2', '10', 'G03'], '10'), ['2', 'G03']);
  assert.deepEqual(toggleComparison(['2', 'G03'], '201'), ['2', 'G03', '201']);
});
