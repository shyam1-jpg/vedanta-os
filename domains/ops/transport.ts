/** Shuttle runs. Arrival times are clustered into a wait window, within the vehicle.
 *  No payment is taken. A manifest uses a first name, the party size, and access needs.
 */

export type TravelMode = "shuttle" | "own_car" | "taxi" | "lift" | "other";
export type TravelDirection = "arrival" | "departure";

export type ShuttleService = {
  id: string;
  name: string;
  route: string;
  capacity: number;
  driver: string;
  travelMinutes: number;
  meetingPoint: string;
};

export type TravelRequest = {
  personKey: string;
  firstName: string;
  party: number;
  groupId: string;
  groupName: string;
  direction: TravelDirection;
  mode: TravelMode;
  trainTime: string | null;
  date: string;
  access: string[];
};

export type ShuttleSeat = {
  personKey: string;
  firstName: string;
  party: number;
  groupId: string;
  groupName: string;
  access: string[];
  mark: "expected" | "picked_up" | "no_show";
};

export type ShuttleRun = {
  id: string;
  serviceId: string;
  direction: TravelDirection;
  date: string;
  pickupTime: string;
  meetingPoint: string;
  trainFrom: string;
  trainTo: string;
  confirmed: boolean;
  overflow: boolean;
  seats: ShuttleSeat[];
};

export const DEFAULT_WINDOW_MINUTES = 45;

export function seedShuttle(): ShuttleService {
  return {
    id: "station",
    name: "Station shuttle",
    route: "Example Station to the house",
    capacity: 8,
    driver: "Example Driver",
    travelMinutes: 25,
    meetingPoint: "Example Station, the taxi rank",
  };
}

function minutes(clock: string): number {
  const match = String(clock).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return -1;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return -1;
  return hour * 60 + minute;
}

function clock(total: number): string {
  const day = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`;
}

function firstName(value: string): string {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean)[0] || "Guest";
}

function partyOf(value: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseWindow(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 10 || n > 180) return DEFAULT_WINDOW_MINUTES;
  return n;
}

export function proposeRuns(input: {
  service: ShuttleService;
  requests: TravelRequest[];
  windowMinutes: number;
  direction: TravelDirection;
  date: string;
}): { runs: ShuttleRun[]; skipped: { personKey: string; reason: string }[] } {
  const windowMinutes = parseWindow(input.windowMinutes);
  const skipped: { personKey: string; reason: string }[] = [];
  const queue = input.requests
    .filter(row => row.direction === input.direction && row.date === input.date)
    .filter(row => {
      if (row.mode !== "shuttle") {
        skipped.push({ personKey: row.personKey, reason: "Not on the shuttle" });
        return false;
      }
      if (minutes(row.trainTime ?? "") < 0) {
        skipped.push({ personKey: row.personKey, reason: "No train time" });
        return false;
      }
      return true;
    })
    .sort((a, b) => minutes(a.trainTime ?? "") - minutes(b.trainTime ?? ""));

  const groups: TravelRequest[][] = [];
  for (const person of queue) {
    const open = groups[groups.length - 1];
    const seats = open ? open.reduce((sum, row) => sum + partyOf(row.party), 0) : 0;
    const earliest = open ? minutes(open[0].trainTime ?? "") : -1;
    const fitsWindow = open && minutes(person.trainTime ?? "") - earliest <= windowMinutes;
    const fitsSeats = open && seats + partyOf(person.party) <= input.service.capacity;
    if (open && fitsWindow && fitsSeats) open.push(person);
    else groups.push([person]);
  }

  const runs = groups.map((group, index) => {
    const times = group.map(row => minutes(row.trainTime ?? ""));
    const from = Math.min(...times);
    const to = Math.max(...times);
    const seats = group.reduce((sum, row) => sum + partyOf(row.party), 0);
    const pickup = input.direction === "arrival" ? to : from - input.service.travelMinutes;
    return {
      id: `${input.service.id}:${input.date}:${input.direction}:${index + 1}`,
      serviceId: input.service.id,
      direction: input.direction,
      date: input.date,
      pickupTime: clock(pickup),
      meetingPoint: input.direction === "arrival" ? input.service.meetingPoint : "Front desk",
      trainFrom: clock(from),
      trainTo: clock(to),
      confirmed: false,
      overflow: seats > input.service.capacity,
      seats: group.map(row => ({
        personKey: row.personKey,
        firstName: firstName(row.firstName),
        party: partyOf(row.party),
        groupId: row.groupId,
        groupName: row.groupName,
        access: row.access.filter(item => item === "wheelchair" || item === "luggage"),
        mark: "expected" as const,
      })),
    };
  });
  return { runs, skipped };
}

export function manifest(run: ShuttleRun): string[] {
  return run.seats.map(seat => {
    const access = seat.access.length ? ` · ${seat.access.join(", ")}` : "";
    return `${seat.firstName} · party ${seat.party}${access}`;
  });
}

export function guestPickup(runs: ShuttleRun[], personKey: string): { time: string; meetingPoint: string } | null {
  for (const run of runs) {
    if (run.seats.some(seat => seat.personKey === personKey)) return { time: run.pickupTime, meetingPoint: run.meetingPoint };
  }
  return null;
}

export function organiserShuttles(runs: ShuttleRun[], groupId: string): { name: string; time: string; meetingPoint: string; direction: TravelDirection }[] {
  const lines: { name: string; time: string; meetingPoint: string; direction: TravelDirection }[] = [];
  for (const run of runs) {
    for (const seat of run.seats) {
      if (seat.groupId !== groupId) continue;
      lines.push({ name: seat.firstName, time: run.pickupTime, meetingPoint: run.meetingPoint, direction: run.direction });
    }
  }
  return lines;
}

export function lateTrain(run: ShuttleRun, personKey: string, newTime: string, windowMinutes: number): { fits: boolean; suggestion: string } {
  const seat = run.seats.find(item => item.personKey === personKey);
  const who = seat?.firstName ?? "Guest";
  const next = minutes(newTime);
  if (next < 0) return { fits: false, suggestion: `Re-plan: ${who} has no readable train time.` };
  const from = minutes(run.trainFrom);
  const to = minutes(run.trainTo);
  const earliest = Math.min(from, next);
  const latest = Math.max(to, next);
  const fits = latest - earliest <= parseWindow(windowMinutes);
  if (fits) return { fits: true, suggestion: `${who} still fits this shuttle.` };
  return { fits: false, suggestion: `Re-plan: ${who}'s train is now ${clock(next)}, outside the ${parseWindow(windowMinutes)}-minute window.` };
}

export function moveSeat(runs: ShuttleRun[], personKey: string, toRunId: string, capacity: number): { ok: true; runs: ShuttleRun[] } | { ok: false; error: string } {
  const next = runs.map(run => ({ ...run, seats: run.seats.map(seat => ({ ...seat })) }));
  let seat: ShuttleSeat | null = null;
  for (const run of next) {
    const index = run.seats.findIndex(item => item.personKey === personKey);
    if (index >= 0) seat = run.seats.splice(index, 1)[0];
  }
  if (!seat) return { ok: false, error: "That guest is not on a shuttle" };
  const target = next.find(run => run.id === toRunId);
  if (!target) return { ok: false, error: "That shuttle is not on the list" };
  const used = target.seats.reduce((sum, item) => sum + item.party, 0);
  if (used + seat.party > capacity) return { ok: false, error: "That shuttle is full" };
  target.seats.push(seat);
  target.overflow = target.seats.reduce((sum, item) => sum + item.party, 0) > capacity;
  return { ok: true, runs: next };
}

export function markSeat(run: ShuttleRun, personKey: string, mark: "picked_up" | "no_show"): ShuttleRun | null {
  if (!run.seats.some(seat => seat.personKey === personKey)) return null;
  return { ...run, seats: run.seats.map(seat => seat.personKey === personKey ? { ...seat, mark } : seat) };
}

export function shuttleLetter(pickup: { time: string; meetingPoint: string } | null): string {
  if (!pickup) return "No shuttle is booked. Reply if you are coming by train and would like a seat.";
  return `Your shuttle leaves at ${pickup.time}. Meet at ${pickup.meetingPoint}.`;
}
