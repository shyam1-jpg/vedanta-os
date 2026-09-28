"use client";
import { useEffect, useMemo, useState } from "react";
import { API, ApiError, api, token } from "@/lib/api";

type Room = { id: string; number: string; section: string; type: string; max_capacity: number; features: string[]; beds_single: number; beds_double: number; beds_king: number };
type Group = { id: string; name: string; colour: string; arrival: string; departure: string; organisation: string | null };
type Stay = { room_id: string; room: string; date: string; slot: string; group_id: string | null; person_id: string | null; client: string; group_name: string | null; colour: string | null };
type Hold = { group_id: string; room_id: string; room: string; name: string; colour: string; arrival: string; departure: string };
type Guest = { group_id: string; person_id: string; given_name: string; family_name: string; client_note?: string; needs_access?: boolean; single_occupancy?: boolean; details_complete?: boolean };
type Conflict = { roomId: string; date: string; slot: string; groups: string[] };
type RoomSettings = { cutoff_days: number; staff_email: string; reminder_days: number[] };
type Board = { from: string; to: string; rooms: Room[]; groups: Group[]; occupancy: Stay[]; holds: Hold[]; attendees: Guest[]; conflicts: Conflict[]; settings: RoomSettings };
type Preview = { placements: { person_id: string; name: string; room: string; reason: string; kept: boolean }[]; unassigned: { personId: string; name: string; reason: string }[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (from: string, days: number) => { const d = new Date(`${from}T00:00:00`); d.setDate(d.getDate() + days); return ymd(d); };
const span = (from: string, to: string) => {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (; d <= end && out.length < 45; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

export default function RoomAssignBoard() {
  const start = ymd(new Date());
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(plus(start, 45));
  const [board, setBoard] = useState<Board | null>(null);
  const [groupId, setGroupId] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [allRooms, setAllRooms] = useState(false);
  const [holdsFor, setHoldsFor] = useState("");
  const [held, setHeld] = useState<string[]>([]);
  const [move, setMove] = useState({ group_id: "", person_id: "", room_id: "" });
  const [settings, setSettings] = useState<RoomSettings>({ cutoff_days: 7, staff_email: "", reminder_days: [14, 7, 2] });
  const [reminderText, setReminderText] = useState("14, 7, 2");
  const [code, setCode] = useState<string | null>(null);
  const [lockMove, setLockMove] = useState(false);
  const [autoFor, setAutoFor] = useState("");
  const [reassignAll, setReassignAll] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [logFor, setLogFor] = useState("");
  const [log, setLog] = useState<{ occurred_at: string; action: string; actor_type: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const say = (text: string) => { setToast(text); setTimeout(() => setToast(null), 3500); };

  const load = async () => {
    const next = await api<Board>(`/v1/room-assign?from=${from}&to=${to}`);
    setBoard(next);
    setSettings({ ...next.settings, reminder_days: next.settings.reminder_days ?? [14, 7, 2] });
    setReminderText((next.settings.reminder_days ?? [14, 7, 2]).join(", "));
  };
  useEffect(() => { load().catch(e => say((e as Error).message)); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = board ? span(board.from, board.to) : [];
  const names = useMemo(() => new Map((board?.groups ?? []).map(group => [group.id, group])), [board]);
  const visibleRooms = (board?.rooms ?? []).filter(room => {
    if (roomNo && room.number !== roomNo) return false;
    if (allRooms) return true;
    const used = (board?.occupancy ?? []).some(row => row.room_id === room.id && (!groupId || row.group_id === groupId));
    const hold = (board?.holds ?? []).some(row => row.room_id === room.id && (!groupId || row.group_id === groupId));
    return used || hold;
  });

  const cell = (room: Room, date: string) => {
    const stays = (board?.occupancy ?? []).filter(row => row.room_id === room.id && row.date === date && (!groupId || row.group_id === groupId));
    const hold = (board?.holds ?? []).find(row => row.room_id === room.id && row.arrival <= date && row.departure >= date && (!groupId || row.group_id === groupId));
    const groupIds = [...new Set(stays.map(row => row.group_id).filter(Boolean))] as string[];
    return { stays, hold, conflict: groupIds.length > 1 };
  };

  const download = async () => {
    const headers: Record<string, string> = {};
    const t = token.get(); if (t) headers.authorization = `Bearer ${t}`;
    const params = new URLSearchParams({ from, to });
    if (groupId) params.set("group_id", groupId);
    if (roomNo) params.set("room", roomNo);
    const res = await fetch(`${API}/v1/room-assign.csv?${params}`, { headers });
    if (!res.ok) { say("Could not download the room list"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `room-allocation-${from}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveHolds = async (confirm = false) => {
    if (!holdsFor) return;
    try {
      await api(`/v1/groups/${holdsFor}/room-holds`, { method: "POST", body: JSON.stringify({ room_ids: held, confirm }) });
      say("Rooms held");
      load();
    } catch (e) {
      const problem = e instanceof ApiError ? e.problem as ApiError["problem"] & { warnings?: string[] } : null;
      if (!confirm && problem?.code === "confirm" && problem.warnings?.length && window.confirm(problem.warnings.join("\n\n"))) {
        await saveHolds(true);
        return;
      }
      say((e as Error).message);
    }
  };
  const saveMove = async () => {
    if (!move.group_id || !move.person_id || !move.room_id) return;
    await api(`/v1/groups/${move.group_id}/room-assign`, { method: "POST", body: JSON.stringify({ person_id: move.person_id, room_id: move.room_id, locked: lockMove }) });
    say("Assignment saved");
    load();
  };
  const previewAuto = async () => {
    if (!autoFor) return;
    const next = await api<Preview>(`/v1/groups/${autoFor}/room-assign/preview`, { method: "POST", body: JSON.stringify({ reassign_all: reassignAll }) });
    setPreview(next);
  };
  const saveAuto = async () => {
    if (!autoFor) return;
    await api(`/v1/groups/${autoFor}/room-assign/auto`, { method: "POST", body: JSON.stringify({ reassign_all: reassignAll }) });
    setPreview(null);
    say("Rooms assigned");
    load();
  };
  const loadLog = async (id: string) => {
    setLogFor(id);
    if (!id) { setLog([]); return; }
    const body = await api<{ items: { occurred_at: string; action: string; actor_type: string }[] }>(`/v1/groups/${id}/room-changelog`);
    setLog(body.items);
  };
  const rooming = async (id: string, kind: "csv" | "pdf") => {
    const headers: Record<string, string> = {};
    const t = token.get(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/groups/${id}/rooming.${kind}`, { headers });
    if (!res.ok) { say("Could not download the rooming list"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = kind === "pdf" ? "rooming-list.pdf" : "rooming-list.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const sendCode = async (id: string) => {
    const issued = await api<{ code: string; emailed: boolean }>(`/v1/groups/${id}/organiser-code`, { method: "POST", body: "{}" });
    setCode(issued.code);
    say(issued.emailed ? "Access code sent" : "Access code ready to copy");
  };

  const guests = (board?.attendees ?? []).filter(person => person.group_id === move.group_id);
  const holdRooms = (board?.rooms ?? []).filter(room => !roomNo || room.number === roomNo);

  return (
    <>
      <div className="topbar"><div><h1>Room allocation</h1><p>Every retreat on the board, for the dates you choose. A colour is one organiser.</p></div></div>
      <div className="panel roomalloc" data-testid="room-board">
        <div className="roomalloc-filters">
          <label>From<input type="date" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>To<input type="date" aria-label="To" value={to} onChange={e => setTo(e.target.value)} /></label>
          <label>Retreat
            <select aria-label="Retreat" value={groupId} onChange={e => setGroupId(e.target.value)}>
              <option value="">All retreats</option>
              {(board?.groups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>Room
            <select aria-label="Room filter" value={roomNo} onChange={e => setRoomNo(e.target.value)}>
              <option value="">All rooms</option>
              {(board?.rooms ?? []).map(room => <option key={room.id} value={room.number}>{room.number}</option>)}
            </select>
          </label>
          <label className="assign-check"><input type="checkbox" checked={allRooms} onChange={e => setAllRooms(e.target.checked)} /> Show every room</label>
          <button className="btn" type="button" data-testid="room-export" onClick={download}>Download CSV</button>
        </div>
        <p className="m">Organisers can change rooms until {settings.cutoff_days} days before arrival. After that they send a request.</p>
        {(board?.conflicts.length ?? 0) > 0 && (
          <ul className="roomalloc-conflicts" data-testid="room-conflict">
            {board!.conflicts.map(row => {
              const room = board!.rooms.find(item => item.id === row.roomId)?.number ?? row.roomId;
              const who = row.groups.map(id => names.get(id)?.name ?? "Another group").join(" and ");
              return <li key={`${row.roomId}-${row.date}-${row.slot}`}>{room} on {row.date} {row.slot} is on two lists: {who}.</li>;
            })}
          </ul>
        )}
        <div className="roomalloc-scroll">
          <table className="roomalloc-grid">
            <thead><tr><th>Room</th>{days.map(day => <th key={day}>{day.slice(5)}</th>)}</tr></thead>
            <tbody>
              {visibleRooms.map(room => (
                <tr key={room.id}>
                  <th>{room.number}<small>{room.type} · {room.max_capacity}</small></th>
                  {days.map(day => {
                    const item = cell(room, day);
                    const colour = item.stays.find(row => row.colour)?.colour ?? item.hold?.colour;
                    const label = item.stays.length ? [...new Set(item.stays.map(row => row.client))].join(", ") : item.hold ? "Held" : "";
                    return <td key={day} className={item.conflict ? "is-conflict" : ""} style={colour ? { background: item.stays.length ? colour : "transparent", color: item.stays.length ? "#fff" : "inherit", boxShadow: !item.stays.length && colour ? `inset 0 0 0 3px ${colour}` : undefined } : undefined}>{label}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleRooms.length === 0 && <p>No rooms are held in these dates.</p>}
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Hold rooms</h3>
        <label>Retreat
          <select aria-label="Hold for" value={holdsFor} onChange={e => {
            const id = e.target.value;
            setHoldsFor(id);
            setHeld((board?.holds ?? []).filter(row => row.group_id === id).map(row => row.room_id));
          }}>
            <option value="">Choose a retreat</option>
            {(board?.groups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        {holdsFor && (
          <div className="roomalloc-holds">
            {holdRooms.map(room => (
              <label key={room.id}><input type="checkbox" checked={held.includes(room.id)} onChange={e => setHeld(e.target.checked ? [...held, room.id] : held.filter(id => id !== room.id))} /> {room.number}</label>
            ))}
            <button className="btn primary" type="button" onClick={() => saveHolds().catch(e => say((e as Error).message))}>Save holds</button>
            <button className="btn" type="button" onClick={() => rooming(holdsFor, "csv")}>Rooming CSV</button>
            <button className="btn" type="button" onClick={() => rooming(holdsFor, "pdf")}>Rooming PDF</button>
            <button className="btn" type="button" onClick={() => sendCode(holdsFor).catch(e => say((e as Error).message))}>Send access code</button>
          </div>
        )}
        {code && <p className="note" data-testid="room-code">Access code: {code}. Copy it if the email is only in the log. It will not be shown again.</p>}
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Override an assignment</h3>
        <p className="m">Staff can move a guest after the organiser&apos;s cutoff. The person stays linked to the room, so the kitchen and the arrivals list keep the name.</p>
        <div className="roomalloc-filters">
          <label>Retreat
            <select aria-label="Override retreat" value={move.group_id} onChange={e => setMove({ group_id: e.target.value, person_id: "", room_id: "" })}>
              <option value="">Choose</option>
              {(board?.groups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>Guest
            <select aria-label="Override guest" value={move.person_id} onChange={e => setMove({ ...move, person_id: e.target.value })}>
              <option value="">Choose</option>
              {guests.map(person => <option key={person.person_id} value={person.person_id}>{person.given_name} {person.family_name}</option>)}
            </select>
          </label>
          <label>Room
            <select aria-label="Override room" value={move.room_id} onChange={e => setMove({ ...move, room_id: e.target.value })}>
              <option value="">Choose</option>
              {(board?.holds ?? []).filter(row => row.group_id === move.group_id).map(row => <option key={row.room_id} value={row.room_id}>{row.room}</option>)}
            </select>
          </label>
          <label className="assign-check"><input type="checkbox" checked={lockMove} onChange={e => setLockMove(e.target.checked)} /> Lock this assignment</label>
          <button className="btn primary" type="button" data-testid="room-override" onClick={() => saveMove().catch(e => say((e as Error).message))}>Save assignment</button>
        </div>
        {guests.filter(person => person.client_note || person.needs_access || person.single_occupancy).length > 0 && (
          <ul>
            {guests.map(person => (
              <li key={person.person_id}>
                {person.given_name} {person.family_name}
                {person.client_note ? ` — ${person.client_note}` : ""}
                {person.needs_access ? " — step-free" : ""}
                {person.single_occupancy ? " — single occupancy" : ""}
                {person.details_complete ? " — details complete" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel" style={{ marginTop: 14 }} data-testid="room-auto">
        <h3>Assign the group</h3>
        <p className="m">One click spreads the retreat across the held rooms. Step-free needs go first, then people who asked to share, then single rooms. You see the reason for each room before anything is saved. Hand-set and locked rooms stay put unless you choose to reassign everyone. The organiser can still fine-tune afterwards.</p>
        <div className="roomalloc-filters">
          <label>Retreat
            <select aria-label="Auto assign retreat" value={autoFor} onChange={e => { setAutoFor(e.target.value); setPreview(null); }}>
              <option value="">Choose</option>
              {(board?.groups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="assign-check"><input type="checkbox" checked={reassignAll} onChange={e => setReassignAll(e.target.checked)} /> Reassign all</label>
          <button className="btn" type="button" disabled={!autoFor} onClick={() => previewAuto().catch(e => say((e as Error).message))}>Preview</button>
          <button className="btn primary" type="button" disabled={!autoFor || !preview} onClick={() => saveAuto().catch(e => say((e as Error).message))}>Save assignment</button>
        </div>
        {preview && (
          <ul>
            {preview.placements.map(row => <li key={row.person_id}>{row.name} → {row.room}. {row.reason}</li>)}
            {preview.unassigned.map(row => <li key={row.personId}>{row.name} stays unassigned. {row.reason}</li>)}
          </ul>
        )}
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Change log</h3>
        <label>Retreat
          <select aria-label="Change log retreat" value={logFor} onChange={e => loadLog(e.target.value).catch(err => say((err as Error).message))}>
            <option value="">Choose</option>
            {(board?.groups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <ul>
          {log.map(row => <li key={`${row.occurred_at}-${row.action}`}>{row.occurred_at?.slice(0, 16).replace("T", " ")} · {row.action} · {row.actor_type}</li>)}
          {logFor && log.length === 0 && <li>No room changes recorded yet.</li>}
        </ul>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Lock and notification</h3>
        <div className="roomalloc-filters">
          <label>Days before arrival<input type="number" min={0} max={60} aria-label="Cutoff days" value={settings.cutoff_days} onChange={e => setSettings({ ...settings, cutoff_days: Number(e.target.value) })} /></label>
          <label>House email<input type="email" aria-label="Staff room email" value={settings.staff_email} onChange={e => setSettings({ ...settings, staff_email: e.target.value })} /></label>
          <label>Reminder days before the cut-off<input aria-label="Reminder days" value={reminderText} onChange={e => setReminderText(e.target.value)} /></label>
          <button className="btn" type="button" onClick={() => {
            const reminder_days = reminderText.split(",").map(item => Number(item.trim())).filter(item => Number.isFinite(item));
            api<RoomSettings>("/v1/room-assign/settings", { method: "PUT", body: JSON.stringify({ ...settings, reminder_days }) }).then(next => { setSettings(next); setReminderText(next.reminder_days.join(", ")); say("Lock saved"); }).catch(e => say((e as Error).message));
          }}>Save</button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
