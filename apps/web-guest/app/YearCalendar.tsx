"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  addDays,
  allowedYears,
  dayAria,
  dayIndex,
  displayKind,
  londonTodayISO,
  monthWeeks,
  formatDay,
  type DayStatus,
  type PublicRetreat,
  type PublicYearAvailability,
  type YearRow,
} from "./calendar-dates";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function loadYear(year: number): Promise<PublicYearAvailability> {
  const res = await fetch(`${API}/v1/public/availability?year=${year}`, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? "The year could not be loaded");
  return body as PublicYearAvailability;
}

function rowsOf(data: PublicYearAvailability): YearRow[] {
  if (data.view === "rooms" && data.rooms?.length) {
    return data.rooms.map(room => ({
      key: `room-${room.number}`,
      title: `Room ${room.number}`,
      meta: room.name,
      total: 1,
      status: room.status,
      free: room.free,
    }));
  }
  return data.types.map(type => ({
    key: `type-${type.code}-${type.accessible ? "a" : "n"}`,
    title: type.name,
    meta: `${type.total} ${type.total === 1 ? "room" : "rooms"} · sleeps up to ${type.sleeps}`,
    total: type.total,
    status: type.status,
    free: type.free,
  }));
}

function spaceLabel(retreat: PublicRetreat): string {
  if (retreat.spaces === "full") return "Full";
  if (retreat.capacity == null) return "Spaces available";
  const left = Math.max(0, retreat.capacity - retreat.booked);
  if (retreat.spaces === "limited") return left === 1 ? "1 space left" : `${left} spaces left`;
  return left === 1 ? "1 space" : `${left} spaces`;
}

function spaceMark(retreat: PublicRetreat): string {
  if (retreat.spaces === "full") return "●";
  if (retreat.spaces === "limited") return "◐";
  return "○";
}

export default function YearCalendar({
  onPickNight,
  onPickRetreat,
}: {
  onPickNight: (arrival: string, departure: string) => void;
  onPickRetreat: (retreat: PublicRetreat) => void;
}) {
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [mode, setMode] = useState<"rooms" | "retreats">("rooms");
  const [month, setMonth] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
  const [data, setData] = useState<PublicYearAvailability | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<{ key: string; date: string } | null>(null);
  const cache = useRef(new Map<number, PublicYearAvailability>());
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const t = londonTodayISO();
    setToday(t);
    setYear(Number(t.slice(0, 4)));
    setMonth(Number(t.slice(5, 7)) - 1);
    setReady(true);
  }, []);

  useEffect(() => {
    if (year == null) return;
    const cached = cache.current.get(year);
    if (cached) {
      setData(cached);
      setErr(null);
      return;
    }
    let cancel = false;
    setBusy(true);
    setErr(null);
    loadYear(year).then(body => {
      cache.current.set(year, body);
      if (!cancel) setData(body);
    }).catch(e => {
      if (!cancel) { setData(null); setErr((e as Error).message); }
    }).finally(() => { if (!cancel) setBusy(false); });
    return () => { cancel = true; };
  }, [year]);

  if (!ready || year == null || today == null) {
    return (
      <section className="year-cal" aria-busy="true" aria-labelledby="year-cal-title">
        <h2 id="year-cal-title">Availability</h2>
        <p className="lead">Loading the year…</p>
      </section>
    );
  }

  const bounds = allowedYears(today);
  const rows = data ? rowsOf(data) : [];
  const active = rows[Math.min(rowIndex, Math.max(rows.length - 1, 0))];

  const moveYear = (delta: number, monthAfter?: number) => {
    const next = year + delta;
    if (next < bounds.min || next > bounds.max) return;
    setYear(next);
    setRowIndex(0);
    setFocus(null);
    if (monthAfter != null) setMonth(monthAfter);
    else if (next !== Number(today.slice(0, 4))) setMonth(0);
    else setMonth(Number(today.slice(5, 7)) - 1);
  };

  const moveMonth = (delta: number) => {
    const next = month + delta;
    if (next < 0) { moveYear(-1, 11); return; }
    if (next > 11) { moveYear(1, 0); return; }
    setMonth(next);
  };

  const pickDay = (date: string, kind: string) => {
    if (kind !== "available") return;
    onPickNight(date, addDays(date, 2));
  };

  const onDayKey = (e: KeyboardEvent<HTMLButtonElement>, rowKey: string, date: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step == null) return;
    e.preventDefault();
    const next = addDays(date, step);
    if (Number(next.slice(0, 4)) !== year) return;
    setFocus({ key: rowKey, date: next });
    setMonth(Number(next.slice(5, 7)) - 1);
    requestAnimationFrame(() => document.getElementById(`day-${rowKey}-${next}`)?.focus());
  };

  return (
    <section className="year-cal" aria-labelledby="year-cal-title">
      <div className="year-head">
        <div>
          <h2 id="year-cal-title">Availability</h2>
          <p className="lead">Rooms and retreats for the year. Dates follow UK time. A night that is booked, held for a group, or closed for maintenance is marked unavailable.</p>
        </div>
        <div className="year-nav" role="group" aria-label="Year">
          <button type="button" className="year-arrow" aria-label="Previous year" disabled={year <= bounds.min} onClick={() => moveYear(-1)}>‹</button>
          <span className="year-num" aria-live="polite">{year}</span>
          <button type="button" className="year-arrow" aria-label="Next year" disabled={year >= bounds.max} onClick={() => moveYear(1)}>›</button>
        </div>
      </div>

      <div className="year-tabs" role="tablist" aria-label="Availability">
        <button type="button" role="tab" id="tab-rooms" aria-selected={mode === "rooms"} aria-controls="panel-rooms" className={mode === "rooms" ? "on" : ""} onClick={() => setMode("rooms")}>Rooms</button>
        <button type="button" role="tab" id="tab-retreats" aria-selected={mode === "retreats"} aria-controls="panel-retreats" className={mode === "retreats" ? "on" : ""} onClick={() => setMode("retreats")}>Retreats</button>
      </div>

      {err && <div className="note">{err}</div>}
      {busy && !data && <p className="m">Loading {year}…</p>}

      {mode === "rooms" && data && (
        <div role="tabpanel" id="panel-rooms" aria-labelledby="tab-rooms">
          <p className="sr">Arrow keys move between days. Enter chooses an available night, which opens your dates for a two-night stay.</p>
          {rows.length === 0 && <p className="m">No guest rooms are on the book yet.</p>}
          <ul className="year-legend">
            <li><span className="swatch ok" aria-hidden="true" /> Available</li>
            <li><span className="swatch few" aria-hidden="true" /> Few rooms left</li>
            <li><span className="swatch no" aria-hidden="true" /> Unavailable — booked, held, or closed</li>
            <li><span className="swatch past" aria-hidden="true" /> Past</li>
          </ul>
          {rows.length > 0 && (
            <div className="year-phone-only">
              <label htmlFor="year-row">Room{data.view === "types" ? " type" : ""}</label>
              <select id="year-row" value={active?.key ?? ""} onChange={e => setRowIndex(rows.findIndex(r => r.key === e.target.value))}>
                {rows.map(row => <option key={row.key} value={row.key}>{row.title}</option>)}
              </select>
              <div className="year-nav month-nav">
                <button type="button" className="year-arrow" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
                <span aria-live="polite">{MONTHS[month]} {year}</span>
                <button type="button" className="year-arrow" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
              </div>
            </div>
          )}
          <div
            onTouchStart={e => { touchX.current = e.changedTouches[0]?.clientX ?? null; }}
            onTouchEnd={e => {
              const start = touchX.current;
              const end = e.changedTouches[0]?.clientX;
              touchX.current = null;
              if (start == null || end == null) return;
              if (end - start > 48) moveMonth(-1);
              else if (start - end > 48) moveMonth(1);
            }}
          >
            {rows.map(row => (
              <article key={row.key} className={"year-type" + (active?.key === row.key ? " is-on" : "")}>
                <header className="year-type-h">
                  <h3>{row.title}</h3>
                  <span>{row.meta}</span>
                </header>
                <div className="year-months">
                  {MONTHS.map((name, mi) => (
                    <MonthGrid
                      key={name}
                      name={name}
                      monthIndex={mi}
                      year={year}
                      row={row}
                      today={today}
                      open={mi === month}
                      focusDate={focus?.key === row.key ? focus.date : null}
                      onPick={pickDay}
                      onKey={onDayKey}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {mode === "retreats" && (
        <div role="tabpanel" id="panel-retreats" aria-labelledby="tab-retreats">
          <ul className="year-legend">
            <li><span className="space-mark available" aria-hidden="true">○</span> Spaces available</li>
            <li><span className="space-mark limited" aria-hidden="true">◐</span> Limited spaces</li>
            <li><span className="space-mark full" aria-hidden="true">●</span> Full</li>
          </ul>
          {data && data.retreats.length === 0 && <p className="m">No published retreats in {year}. Rooms may still be free.</p>}
          <div className="retreat-list">
            {data?.retreats.map(retreat => {
              const past = retreat.departure < today;
              const label = past ? "Past" : spaceLabel(retreat);
              const text = `${retreat.name}, ${formatDay(retreat.arrival)} to ${formatDay(retreat.departure)}, ${label}`;
              const rail = monthsTouched(retreat.arrival, retreat.departure, year);
              const inner = (
                <>
                  <span className={"space-mark " + (past ? "past" : retreat.spaces)} aria-hidden="true">{past ? "–" : spaceMark(retreat)}</span>
                  <span className="retreat-copy">
                    <strong>{retreat.name}</strong>
                    <span className="d">{retreat.kind} · {formatDay(retreat.arrival)} – {formatDay(retreat.departure)}</span>
                    <span className="rail" aria-hidden="true">
                      {MONTHS.map((name, i) => <i key={name} className={rail[i] ? "on" : ""} title={name} />)}
                    </span>
                  </span>
                  <span className={"space-label " + (past ? "past" : retreat.spaces)}>{label}</span>
                </>
              );
              if (past) return <div key={retreat.id} className="retreat-row past" aria-label={text}>{inner}</div>;
              return (
                <button key={retreat.id} type="button" className="retreat-row" aria-label={text} onClick={() => onPickRetreat(retreat)}>
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function monthsTouched(arrival: string, departure: string, year: number): boolean[] {
  const flags = Array(12).fill(false);
  const start = arrival < `${year}-01-01` ? `${year}-01-01` : arrival;
  const end = departure > `${year}-12-31` ? `${year}-12-31` : departure;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (d.slice(0, 4) !== String(year)) break;
    flags[Number(d.slice(5, 7)) - 1] = true;
    if (d === end) break;
  }
  return flags;
}

function MonthGrid({
  name, monthIndex, year, row, today, open, focusDate, onPick, onKey,
}: {
  name: string;
  monthIndex: number;
  year: number;
  row: YearRow;
  today: string;
  open: boolean;
  focusDate: string | null;
  onPick: (date: string, kind: string) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, rowKey: string, date: string) => void;
}) {
  const weeks = monthWeeks(year, monthIndex);
  const defaultDate = weeks.flat().find(Boolean) ?? null;
  return (
    <div className={"year-month" + (open ? " is-on" : "")}>
      <h4>{name}</h4>
      <div role="grid" aria-label={`${name} ${year}, ${row.title}`}>
        <div role="row" className="dow">
          {DOW.map(d => <div role="columnheader" key={d} aria-label={d}>{d.slice(0, 1)}</div>)}
        </div>
        {weeks.map((week, wi) => (
          <div role="row" key={wi} className="week">
            {week.map((date, di) => {
              if (!date) return <div role="gridcell" key={di} className="year-day empty" />;
              const i = dayIndex(date, year);
              const code = row.status[i] ?? "u";
              const status: DayStatus = code === "a" ? "available" : code === "b" ? "blocked" : "unavailable";
              const free = row.free[i] ?? 0;
              const kind = displayKind(date, status, today);
              const few = kind === "available" && free > 0 && free / row.total <= 0.25;
              const detail = kind === "available"
                ? (row.total === 1 ? "1 room free" : `${free} of ${row.total} rooms free`)
                : undefined;
              const tab = focusDate != null ? focusDate === date : open && date === defaultDate;
              const cls = ["year-day", kind === "past" ? "past" : kind === "available" ? (few ? "few" : "ok") : "no"].join(" ");
              return (
                <button
                  key={date}
                  id={`day-${row.key}-${date}`}
                  type="button"
                  role="gridcell"
                  className={cls}
                  aria-label={dayAria(date, kind, detail)}
                  aria-disabled={kind !== "available"}
                  tabIndex={tab ? 0 : -1}
                  onClick={() => onPick(date, kind)}
                  onKeyDown={e => onKey(e, row.key, date)}
                >
                  <span className="n">{Number(date.slice(8))}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
