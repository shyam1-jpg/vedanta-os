import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskSignals, triageScore, sortTasks, taskLane, matchesTask, type CommandTask } from './task-command.ts';
const base: CommandTask = { id: '1', title: 'Inspect oven', notes: '', department: 'KITCHEN', status: 'new', priority: 'normal', severity: 'none', overdue: false, due_at: null, assigned_staff_id: 'person', assigned_label: '', assigned_name: 'Chef', expected_minutes: null, room_label: '', location_label: 'Kitchen', asset_label: 'Rational', event_label: '', blocked_reason: '', created_at: '2026-10-01T08:00:00Z' };
test('critical open work outranks ordinary and closed work', () => {
 const critical = { ...base, id: '2', severity: 'critical' };
 const done = { ...critical, id: '3', status: 'verified', overdue: true };
 assert.equal(sortTasks([base, done, critical], 'triage')[0].id, '2');
 assert.equal(triageScore(done), -1); assert.deepEqual(taskSignals(done), []);
});
test('today uses London dates across midnight and daylight saving', () => {
 assert.ok(taskSignals({ ...base, due_at: '2026-10-01T23:30:00Z' }, new Date('2026-10-02T00:15:00Z')).includes('Due today'));
 assert.ok(!taskSignals({ ...base, due_at: '2026-10-01T21:00:00Z' }, new Date('2026-10-01T23:30:00Z')).includes('Due today'));
 assert.ok(taskSignals({ ...base, due_at: '2026-12-01T23:30:00Z' }, new Date('2026-12-01T22:00:00Z')).includes('Due today'));
});
test('triage reports blockers and missing owner, preserves original ordering', () => {
 const blocked = { ...base, id: '2', status: 'blocked', assigned_staff_id: null, assigned_name: null };
 assert.deepEqual(taskSignals(blocked), ['Blocked', 'No owner']);
 const original = [base, blocked]; sortTasks(original, 'triage'); assert.equal(original[0].id, '1');
 assert.equal(taskLane(blocked), 'held'); assert.equal(taskLane({status: 'awaiting_approval'}), 'approval');
});
test('search combines asset, place and owner without unsafe regular expressions', () => {
 assert.equal(matchesTask(base, 'rational chef'), true); assert.equal(matchesTask(base, 'room 101'), false); assert.equal(matchesTask(base, '['), false);
});
test('undated tasks follow dated work and cancellation is closed', () => {
 assert.equal(sortTasks([base, { ...base, id: '2', due_at: '2026-10-02T10:00:00Z' }], 'due')[0].id, '2'); assert.equal(taskLane({status: 'cancelled'}), 'closed');
});
