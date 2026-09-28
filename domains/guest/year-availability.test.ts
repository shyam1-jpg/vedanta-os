import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_AVAILABILITY_CACHE,
  addDays,
  allowPublicRead,
  allowedYears,
  buildPublicAvailability,
  datesInYear,
  dayAria,
  dayIndex,
  displayKind,
  londonTodayISO,
  monthWeeks,
  personFieldPaths,
  retreatSpaces,
  type ProgrammeFact,
  type RoomFact,
} from "./year-availability.ts";
import {
  addDays as clientAddDays,
  dayAria as clientDayAria,
  displayKind as clientDisplayKind,
  londonTodayISO as clientLondonToday,
  monthWeeks as clientMonthWeeks,
} from "../../apps/web-guest/app/calendar-dates.ts";

const twin = (number: string, extra: Partial<RoomFact> = {}): RoomFact => ({
  number,
  type: "TWIN",
  typeName: "Twin room",
  sleeps: 2,
  accessible: false,
  blocked: false,
  ...extra,
});

describe("London dates", () => {
  it("uses Europe/London and does not slip a day in BST", () => {
    // 23:30 UTC is 00:30 the next morning in London while BST is in force.
    assert.equal(londonTodayISO(new Date("2026-06-21T23:30:00Z")), "2026-06-22");
    assert.notEqual(new Date("2026-06-21T23:30:00Z").toISOString().slice(0, 10), "2026-06-22");
    // Still GMT just before the clocks change.
    assert.equal(londonTodayISO(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
    // Winter: 23:30 UTC is still the same London date.
    assert.equal(londonTodayISO(new Date("2026-01-15T23:30:00Z")), "2026-01-15");
    // After the October change, 00:30 UTC is 00:30 GMT.
    assert.equal(londonTodayISO(new Date("2026-10-25T00:30:00Z")), "2026-10-25");
    const instants = ["2026-06-21T23:30:00Z", "2026-03-29T00:30:00Z", "2026-01-15T23:30:00Z", "2026-10-25T00:30:00Z"];
    for (const iso of instants) {
      const at = new Date(iso);
      assert.equal(clientLondonToday(at), londonTodayISO(at));
    }
    assert.equal(clientAddDays("2026-03-28", 1), addDays("2026-03-28", 1));
    assert.equal(clientDayAria("2027-03-12", "unavailable"), dayAria("2027-03-12", "unavailable"));
    assert.equal(clientDisplayKind("2026-01-02", "available", "2026-09-28"), displayKind("2026-01-02", "available", "2026-09-28"));
    assert.deepEqual(clientMonthWeeks(2027, 2), monthWeeks(2027, 2));
  });

  it("limits the switcher to this year and the two after it", () => {
    assert.deepEqual(allowedYears("2026-09-28"), { min: 2026, max: 2028 });
  });

  it("builds calendar dates without a timezone shift", () => {
    assert.equal(datesInYear(2027).length, 365);
    assert.equal(datesInYear(2028).length, 366);
    assert.equal(datesInYear(2028)[59], "2028-02-29");
    assert.equal(addDays("2027-03-12", 2), "2027-03-14");
    assert.equal(addDays("2026-03-28", 1), "2026-03-29");
    assert.equal(dayIndex("2027-03-12", 2027), 70);
    const march = monthWeeks(2027, 2);
    assert.equal(march[0][0], "2027-03-01");
    assert.equal(march[0].filter(Boolean).length, 7);
  });

  it("labels a day for a screen reader", () => {
    assert.equal(dayAria("2027-03-12", "unavailable"), "12 March 2027, unavailable");
    assert.equal(dayAria("2027-03-12", "available", "4 of 18 rooms free"), "12 March 2027, available, 4 of 18 rooms free");
    assert.equal(displayKind("2026-01-02", "available", "2026-09-28"), "past");
    assert.equal(displayKind("2026-11-02", "blocked", "2026-09-28"), "unavailable");
    assert.equal(displayKind("2026-11-02", "available", null), "available");
  });
});

describe("year availability", () => {
  const rooms = [twin("101"), twin("102"), twin("G03", { accessible: true, sleeps: 3 })];

  it("marks booked, held and out-of-service nights, and counts the rooms still free", () => {
    const body = buildPublicAvailability({
      year: 2027,
      rooms,
      nights: [
        { room: "101", night: "2027-03-12", held: false },
        { room: "102", night: "2027-03-12", held: true },
        { room: "101", night: "2026-12-31", held: true },
      ],
      programmes: [],
    });
    assert.equal(body.view, "rooms");
    assert.equal(body.timezone, "Europe/London");
    const standard = body.types.find(t => t.code === "TWIN" && !t.accessible);
    assert.ok(standard);
    assert.equal(standard.total, 2);
    assert.equal(standard.status[dayIndex("2027-03-12", 2027)], "u");
    assert.equal(standard.free[dayIndex("2027-03-12", 2027)], 0);
    assert.equal(standard.status[dayIndex("2027-03-13", 2027)], "a");
    assert.equal(standard.free[dayIndex("2027-03-13", 2027)], 2);
    assert.equal(standard.status.length, 365);

    const closed = buildPublicAvailability({
      year: 2027,
      rooms: [twin("201", { blocked: true })],
      nights: [],
      programmes: [],
    });
    assert.equal(closed.types[0].status.includes("a"), false);
    assert.equal(closed.types[0].status[0], "b");
    assert.equal(closed.types[0].free[0], 0);
  });

  it("groups a full house by type and does not list every room", () => {
    const many = Array.from({ length: 41 }, (_, i) => twin(String(100 + i), { type: i % 2 ? "TWIN" : "DOUBLE", typeName: i % 2 ? "Twin room" : "Double room" }));
    const body = buildPublicAvailability({ year: 2027, rooms: many, nights: [], programmes: [] });
    assert.equal(body.view, "types");
    assert.equal(body.rooms, undefined);
    assert.equal(body.types.length, 2);
    assert.ok(body.types.every(t => t.free.every(n => n === t.total)));
  });

  it("rates retreat places from capacity and bookings", () => {
    assert.equal(retreatSpaces(20, 4), "available");
    assert.equal(retreatSpaces(20, 16), "limited");
    assert.equal(retreatSpaces(20, 20), "full");
    assert.equal(retreatSpaces(null, 9), "available");
    const programmes: ProgrammeFact[] = [
      { id: "p1", name: "Lakeside Yoga Retreat", retreat_type: "residential", arrival: "2027-03-10", departure: "2027-03-15", expected_guests: 20, attendees: 16, enquiry_people: 0 },
      { id: "p2", name: "Quiet Day Retreat", retreat_type: "day_retreat", arrival: "2027-06-02", departure: "2027-06-02", expected_guests: 12, attendees: 12, enquiry_people: 0 },
      { id: "p3", name: "Priya Shah", retreat_type: "residential", arrival: "2027-04-01", departure: "2027-04-04", expected_guests: 2, attendees: 1, enquiry_people: 0 },
      { id: "p4", name: "Paul booking", retreat_type: "residential", arrival: "2027-05-01", departure: "2027-05-04", expected_guests: 8, attendees: 0, enquiry_people: 0 },
      { id: "p5", name: "Winter Silence Retreat", retreat_type: "residential", arrival: "2026-12-28", departure: "2027-01-03", expected_guests: 10, attendees: 2, enquiry_people: 1 },
      { id: "p6", name: "Other Year Retreat", retreat_type: "residential", arrival: "2028-02-01", departure: "2028-02-05", expected_guests: 10, attendees: 0, enquiry_people: 0 },
      { id: "p7", name: "Wedding Weekend", retreat_type: "wedding", arrival: "2027-08-01", departure: "2027-08-03", expected_guests: 40, attendees: 10, enquiry_people: 0 },
    ];
    const body = buildPublicAvailability({ year: 2027, rooms: [], nights: [], programmes });
    assert.deepEqual(body.retreats.map(r => [r.id, r.spaces, r.booked]), [
      ["p5", "available", 3],
      ["p1", "limited", 16],
      ["p2", "full", 12],
    ]);
    assert.equal(body.retreats.some(r => r.name === "Priya Shah"), false);
    assert.equal(body.retreats.some(r => /wedding/i.test(r.name)), false);
  });
});

describe("public availability privacy", () => {
  it("returns no person fields, even when the source rows contain them", () => {
    const body = buildPublicAvailability({
      year: 2027,
      rooms: [{
        number: "110",
        type: "TWIN",
        typeName: "Twin room",
        sleeps: 2,
        accessible: false,
        blocked: false,
        notes: "Ada Lovelace stays in this room",
        email: "ada@example.com",
      } as RoomFact],
      nights: [{
        room: "110",
        night: "2027-03-12",
        held: true,
        occupant_label: "Ada Lovelace",
        email: "ada@example.com",
        organiser: "Ada Lovelace",
      } as never],
      programmes: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "Lakeside Yoga Retreat (Ada)",
        retreat_type: "residential",
        arrival: "2027-03-10",
        departure: "2027-03-15",
        expected_guests: 20,
        attendees: 18,
        enquiry_people: 1,
        organisation: "Ada Lovelace",
        contact_email: "ada@example.com",
        notes: "Call Ada on 07000 111222",
        organiser: "Ada Lovelace",
        sheet_text: "Organiser: Ada Lovelace",
        external_ref: "BK-9981",
        host: "Ada Lovelace",
      } as ProgrammeFact],
    });

    assert.deepEqual(personFieldPaths(body), []);
    const raw = JSON.stringify(body);
    for (const secret of ["Ada", "ada@", "Lovelace", "07000", "BK-9981", "occupant", "organiser", "notes"]) {
      assert.equal(raw.toLowerCase().includes(secret.toLowerCase()), false, secret);
    }
    assert.equal(body.retreats[0].name, "Lakeside Yoga Retreat");
    assert.equal(body.retreats[0].spaces, "limited");
    assert.equal(body.types[0].status[dayIndex("2027-03-12", 2027)], "u");
    assert.equal("email" in body, false);
    assert.equal("host" in (body.retreats[0] as object), false);
  });

  it("keeps person columns out of the public SQL", () => {
    const src = readFileSync(new URL("../../services/platform-api/src/publicAvailability.ts", import.meta.url), "utf8");
    assert.match(src, /\/public\/availability/);
    assert.match(src, /PUBLIC_AVAILABILITY_CACHE/);
    assert.doesNotMatch(src, /occupant_label|contact_email|contact_phone|given_name|family_name|organiser_person|sheet_text|display_name|guest_account|e\.email|e\.name|e\.notes/);
  });
});

describe("public read limit", () => {
  it("allows a burst of year views and then asks the caller to wait", () => {
    const hits = new Map<string, { n: number; t: number }>();
    for (let i = 0; i < 30; i++) assert.equal(allowPublicRead(hits, "ip", 1_000, 30, 60_000), true);
    assert.equal(allowPublicRead(hits, "ip", 1_000, 30, 60_000), false);
    assert.equal(allowPublicRead(hits, "ip", 61_000, 30, 60_000), true);
  });

  it("advertises a public Cloudflare cache lifetime", () => {
    assert.match(PUBLIC_AVAILABILITY_CACHE, /public/);
    assert.match(PUBLIC_AVAILABILITY_CACHE, /s-maxage=\d+/);
    assert.match(PUBLIC_AVAILABILITY_CACHE, /max-age=\d+/);
  });
});
