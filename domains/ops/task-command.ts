/** Explainable task triage. Estimates describe work, never staff capacity. */
export type CommandTask = {
  id: string; title: string; notes: string; department: string; status: string;
  priority: string; severity: string; overdue: boolean; due_at: string | null;
  assigned_staff_id: string | null; assigned_label: string; assigned_name: string | null;
  expected_minutes: number | null; room_label: string; location_label: string;
  asset_label: string; event_label: string; blocked_reason: string; created_at: string;
};
export const closed = (t: Pick<CommandTask, 'status'>) => ['completed', 'verified', 'cancelled'].includes(t.status);
export function londonDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function taskSignals(t: CommandTask, now = new Date()): string[] {
  if (closed(t)) return [];
  const signals: string[] = [];
  if (t.severity === 'critical') signals.push('Critical severity');
  if (t.overdue) signals.push('Overdue');
  if (t.status === 'blocked') signals.push('Blocked');
  if (t.priority === 'urgent') signals.push('Urgent priority');
  if (t.status === 'awaiting_approval') signals.push('Needs approval');
  if (!t.assigned_staff_id && !t.assigned_label && !t.assigned_name) signals.push('No owner');
  const due = t.due_at ? new Date(t.due_at) : null;
  if (due && Number.isFinite(due.getTime()) && londonDay(due) === londonDay(now)) signals.push('Due today');
  return signals;
}
export function triageScore(t: CommandTask, now = new Date()): number {
  if (closed(t)) return -1;
  const signals = taskSignals(t, now);
  return (t.severity === 'critical' ? 1000 : t.severity === 'major' ? 200 : 0)
    + (t.overdue ? 400 : 0) + (t.status === 'blocked' ? 250 : 0)
    + ({ urgent: 300, high: 100, normal: 20, low: 0 }[t.priority] ?? 0)
    + (signals.includes('Due today') ? 80 : 0) + (signals.includes('Needs approval') ? 60 : 0)
    + (signals.includes('No owner') ? 40 : 0);
}
export function taskLane(t: Pick<CommandTask, 'status'>) {
  if (closed(t)) return 'closed';
  if (['blocked', 'waiting', 'paused'].includes(t.status)) return 'held';
  if (t.status === 'awaiting_approval') return 'approval';
  if (t.status === 'in_progress') return 'working';
  return 'planned';
}
export function sortTasks<T extends CommandTask>(tasks: T[], sort: string, now = new Date()): T[] {
  return [...tasks].sort((a, b) => {
    if (sort === 'newest') return Date.parse(b.created_at) - Date.parse(a.created_at);
    const aDue = a.due_at ? Date.parse(a.due_at) : Infinity;
    const bDue = b.due_at ? Date.parse(b.due_at) : Infinity;
    if (sort === 'due') return (aDue === bDue ? 0 : aDue - bDue) || a.title.localeCompare(b.title);
    return triageScore(b, now) - triageScore(a, now) || (aDue === bDue ? 0 : aDue - bDue) || a.title.localeCompare(b.title);
  });
}
export function matchesTask(t: CommandTask, search: string): boolean {
  const text = [t.title, t.notes, t.department, t.assigned_name, t.assigned_label, t.room_label,
    t.location_label, t.asset_label, t.event_label, t.blocked_reason].join(' ').toLowerCase();
  return search.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}
