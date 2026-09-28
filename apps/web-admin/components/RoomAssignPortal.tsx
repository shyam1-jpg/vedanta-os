"use client";
/** Public room list for a retreat organiser. Mobile first, drag on a wide screen. */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

const KEY = "vedanta.organiser";
const AL: Record<string, string> = { celery: "Celery", cereals_gluten: "Gluten", crustaceans: "Crustaceans", eggs: "Eggs", fish: "Fish", lupin: "Lupin", milk: "Milk", molluscs: "Molluscs", mustard: "Mustard", nuts: "Tree nuts", peanuts: "Peanuts", sesame: "Sesame", soya: "Soya", sulphites: "Sulphites" };

type Client = {
  person_id: string; given_name: string; family_name: string; name: string; email: string | null;
  room_preference: string | null; share_consent: boolean; needs_access: boolean; arrives_early: boolean;
  diet: string[]; allergens: string[]; severity: string | null; diet_notes: string | null; room_id: string | null;
};
type Room = {
  id: string; number: string; type: string; capacity: number; features: string[];
  beds_single: number; beds_double: number; beds_king: number; empty: number;
  occupants: { person_id: string; name: string }[];
};
type Group = {
  id: string; name: string; organisation: string | null; arrival: string; arrival_slot: string; departure: string; departure_slot: string;
  locked: boolean; lock_from: string | null; note: string | null;
  warnings: { person_id: string; room_id: string; message: string }[];
  unassigned: { person_id: string; name: string }[];
  rooms: Room[];
  clients: Client[];
};
type Board = { cutoff_days: number; groups: Group[] };
type Draft = { person_id?: string; given_name: string; family_name: string; room_preference: string; share_consent: boolean; needs_access: boolean; allergens: string[]; severity: string; diet_notes: string };

const blank = (): Draft => ({ given_name: "", family_name: "", room_preference: "twin", share_consent: true, needs_access: false, allergens: [], severity: "", diet_notes: "" });
const beds = (room: Room) => [room.beds_single && `${room.beds_single} single`, room.beds_double && `${room.beds_double} double`, room.beds_king && `${room.beds_king} king`].filter(Boolean).join(", ") || "beds to be confirmed";
const featureLabel = (code: string) => code === "disabled_access" ? "Step-free" : code.replace(/_/g, " ");

export default function RoomAssignPortal() {
  const [phase, setPhase] = useState<"load" | "code" | "board">("load");
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ groupId: string; personId: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [editing, setEditing] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);

  const say = (text: string) => { setToast(text); setTimeout(() => setToast(null), 2500); };

  const load = async (session: string) => {
    const res = await fetch(`${API}/public/organiser/board`, { headers: { authorization: `Bearer ${session}` } });
    const body = await res.json().catch(() => null);
    if (res.status === 401) { sessionStorage.removeItem(KEY); setToken(null); setPhase("code"); setErr(body?.detail ?? "Sign in to continue"); return; }
    if (!res.ok) throw new Error(body?.detail ?? "The room list could not be opened");
    setToken(session); setBoard(body); setErr(null); setPhase("board");
  };

  useEffect(() => {
    let gone = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const link = params.get("t");
      if (link) {
        const res = await fetch(`${API}/public/organiser/from-form`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link }) });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.detail ?? "This link is not valid");
        sessionStorage.setItem(KEY, body.token);
        const url = new URL(window.location.href);
        url.searchParams.delete("t");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        if (!gone) await load(body.token);
        return;
      }
      const saved = sessionStorage.getItem(KEY);
      if (saved) { if (!gone) await load(saved); return; }
      const guest = sessionStorage.getItem("vedanta.guest.token");
      if (guest) {
        const res = await fetch(`${API}/public/organiser/session`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${guest}` }, body: "{}" });
        if (res.ok) {
          const body = await res.json();
          sessionStorage.setItem(KEY, body.token);
          if (!gone) await load(body.token);
          return;
        }
      }
      if (!gone) setPhase("code");
    })().catch(e => { if (!gone) { setErr((e as Error).message); setPhase("code"); } });
    return () => { gone = true; };
  }, []);

  const signIn = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/organiser/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ access_code: code.trim() }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "That email or access code is not recognised.");
      sessionStorage.setItem(KEY, body.token);
      await load(body.token);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const call = async (path: string, payload: object) => {
    const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.detail ?? "That could not be saved");
    return body;
  };

  const move = async (group: Group, personId: string, roomId: string | null) => {
    if (group.locked) return;
    setSheet(null); setBusy(true); setErr(null);
    const placements = group.clients
      .map(person => ({ person_id: person.person_id, room_id: person.person_id === personId ? roomId : person.room_id }))
      .filter(row => row.room_id);
    try {
      await call("/public/organiser/assignments", { group_id: group.id, placements });
      if (token) await load(token);
      say("Room list saved");
    } catch (e) { setErr((e as Error).message); if (token) await load(token); }
    finally { setBusy(false); }
  };

  const saveGuest = async (groupId: string) => {
    if (!draft.given_name.trim() || !draft.family_name.trim()) { setErr("A guest needs a first and last name"); return; }
    if (draft.allergens.length && !draft.severity) { setErr("Say how serious the allergy is"); return; }
    setBusy(true); setErr(null);
    try {
      await call("/public/organiser/attendees", {
        group_id: groupId,
        attendees: [{
          ...draft,
          person_id: editing ?? undefined,
          share_consent: draft.room_preference === "twin" || draft.share_consent,
          email: undefined,
          severity: draft.severity || undefined,
        }],
      });
      setDraft(blank()); setEditing(null);
      if (token) await load(token);
      say(editing ? "Guest updated" : "Guest added");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const removeGuest = async (group: Group, personId: string) => {
    setBusy(true); setErr(null);
    try {
      await call("/public/organiser/attendees/remove", { group_id: group.id, person_id: personId });
      if (token) await load(token);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const ask = async (groupId: string) => {
    setBusy(true); setErr(null);
    try {
      await call("/public/organiser/change-request", { group_id: groupId, note: request });
      setRequest("");
      say("The house has your note");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (phase === "load") return <div className="pub"><div className="pubcard">Loading…</div></div>;
  if (phase === "code" || !board) {
    return (
      <div className="pub">
        <div className="pubcard">
          <div className="pubbrand">The Vedanta Way<br /><span>Retreat Center</span></div>
          <h1>Arrange rooms</h1>
          <p>Use the access code the house sent you, or open the link from your guest list.</p>
          <label>Access code
            <input aria-label="Access code" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" />
          </label>
          {err && <div className="note">{err}</div>}
          <div className="actions"><button className="btn primary" disabled={busy || code.trim().length < 8} onClick={signIn}>Open the room list</button></div>
        </div>
      </div>
    );
  }

  const sheetGroup = sheet ? board.groups.find(group => group.id === sheet.groupId) : null;
  const sheetPerson = sheetGroup?.clients.find(person => person.person_id === sheet?.personId);

  return (
    <div className="pub assign-page">
      <div className="pubcard" data-testid="assign-board">
        <div className="pubbrand">The Vedanta Way<br /><span>Retreat Center</span></div>
        <h1>Arrange rooms</h1>
        <p className="m">Room changes close {board.cutoff_days} days before arrival. You only see your own retreat.</p>
        {err && <div className="note">{err}</div>}
        {board.groups.map(group => (
          <section key={group.id} className="assign-retreat">
            <h2>{group.name}</h2>
            <p>{group.organisation ? `${group.organisation} · ` : ""}{group.arrival} {group.arrival_slot} → {group.departure} {group.departure_slot}</p>
            {group.locked && <div className="note">The house has locked room changes{group.lock_from ? ` from ${group.lock_from}` : ""}. Ask the house if something needs to move.</div>}
            {group.note && <div className="note">{group.note}</div>}
            <div className="assign-layout">
              <div>
                <h3>Not in a room</h3>
                <ul className="assign-people" data-testid="assign-unassigned">
                  {group.unassigned.map(person => (
                    <li key={person.person_id} className="assign-client" data-testid="assign-client" draggable={!group.locked} onDragStart={e => e.dataTransfer.setData("text/plain", person.person_id)}>
                      <span>{person.name}</span>
                      <button type="button" className="btn assign-open" data-testid="assign-open" disabled={group.locked} onClick={() => setSheet({ groupId: group.id, personId: person.person_id })}>Assign</button>
                    </li>
                  ))}
                  {group.unassigned.length === 0 && <li className="m">Everyone has a room.</li>}
                </ul>
              </div>
              <div className="assign-rooms">
                {group.rooms.map(room => (
                  <article
                    key={room.id}
                    className="assign-room"
                    data-testid="assign-room"
                    onDragOver={e => { if (!group.locked) e.preventDefault(); }}
                    onDrop={e => { e.preventDefault(); const personId = e.dataTransfer.getData("text/plain"); if (personId) move(group, personId, room.id); }}
                  >
                    <header>
                      <strong>{room.number}</strong>
                      <span>{room.type} · sleeps {room.capacity}</span>
                    </header>
                    <p>{beds(room)}{room.features.length ? ` · ${room.features.map(featureLabel).join(", ")}` : ""}</p>
                    <p className="m">{room.empty === 0 ? "No empty beds" : `${room.empty} empty bed${room.empty === 1 ? "" : "s"}`}</p>
                    <ul>
                      {room.occupants.map(person => (
                        <li key={person.person_id} draggable={!group.locked} onDragStart={e => e.dataTransfer.setData("text/plain", person.person_id)}>
                          {person.name}
                          {!group.locked && <button type="button" className="linkbtn" onClick={() => move(group, person.person_id, null)}>remove</button>}
                        </li>
                      ))}
                    </ul>
                    {group.warnings.filter(item => item.room_id === room.id).map(item => <p key={item.person_id} className="assign-warn" data-testid="assign-warning">{item.message}</p>)}
                  </article>
                ))}
                {group.rooms.length === 0 && <p>The house has not held any rooms for this retreat yet.</p>}
              </div>
            </div>
            {group.locked ? (
              <div className="assign-request">
                <label>Ask the house to change a room
                  <textarea aria-label="Change request" rows={3} value={request} onChange={e => setRequest(e.target.value)} />
                </label>
                <button className="btn" disabled={busy || !request.trim()} onClick={() => ask(group.id)}>Send request</button>
              </div>
            ) : (
              <details className="assign-guest">
                <summary>{editing ? "Edit a guest" : "Add a guest"}</summary>
                <div className="fgrid">
                  <label>First name<input aria-label="Guest first name" value={draft.given_name} onChange={e => setDraft({ ...draft, given_name: e.target.value })} /></label>
                  <label>Last name<input aria-label="Guest last name" value={draft.family_name} onChange={e => setDraft({ ...draft, family_name: e.target.value })} /></label>
                  <label>Room
                    <select aria-label="Room preference" value={draft.room_preference} onChange={e => setDraft({ ...draft, room_preference: e.target.value, share_consent: e.target.value === "twin" || draft.share_consent })}>
                      <option value="twin">Sharing (twin)</option>
                      <option value="single">Single room</option>
                      <option value="any">No preference</option>
                    </select>
                  </label>
                </div>
                <label className="assign-check"><input type="checkbox" checked={draft.room_preference === "twin" || draft.share_consent} onChange={e => setDraft({ ...draft, share_consent: e.target.checked })} /> Happy to share a room</label>
                <label className="assign-check"><input type="checkbox" checked={draft.needs_access} onChange={e => setDraft({ ...draft, needs_access: e.target.checked })} /> Needs step-free access</label>
                <div className="lbl">Allergies</div>
                <div className="chips">{Object.entries(AL).map(([key, label]) => <button key={key} type="button" className={"chipbtn" + (draft.allergens.includes(key) ? " on warn" : "")} onClick={() => setDraft({ ...draft, allergens: draft.allergens.includes(key) ? draft.allergens.filter(item => item !== key) : [...draft.allergens, key] })}>{label}</button>)}</div>
                {draft.allergens.length > 0 && <div className="fgrid">
                  <label>How serious?
                    <select aria-label="Allergy severity" value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value })}>
                      <option value="">choose…</option>
                      <option value="INTOLERANCE">Intolerance / discomfort</option>
                      <option value="ALLERGY">Allergy</option>
                      <option value="ANAPHYLAXIS">Severe — risk of anaphylaxis</option>
                    </select>
                  </label>
                  <label>Kitchen note<input aria-label="Allergy note" value={draft.diet_notes} onChange={e => setDraft({ ...draft, diet_notes: e.target.value })} /></label>
                </div>}
                <div className="actions">
                  <button className="btn primary" disabled={busy} onClick={() => saveGuest(group.id)}>{editing ? "Save guest" : "Add guest"}</button>
                  {editing && <button className="btn" type="button" onClick={() => { setEditing(null); setDraft(blank()); }}>Cancel</button>}
                </div>
                <ul className="assign-edit">
                  {group.clients.map(person => (
                    <li key={person.person_id}>
                      <button type="button" className="linkbtn" onClick={() => { setEditing(person.person_id); setDraft({ person_id: person.person_id, given_name: person.given_name, family_name: person.family_name, room_preference: person.room_preference ?? "any", share_consent: person.share_consent, needs_access: person.needs_access, allergens: person.allergens, severity: person.severity ?? "", diet_notes: person.diet_notes ?? "" }); }}>{person.name}</button>
                      <button type="button" className="linkbtn" onClick={() => removeGuest(group, person.person_id)}>remove</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
        {board.groups.length === 0 && <p>There is no retreat on this sign-in.</p>}
        <button className="linkbtn" type="button" onClick={() => { sessionStorage.removeItem(KEY); setPhase("code"); setBoard(null); }}>Use a different code</button>
        {toast && <div className="toast">{toast}</div>}
      </div>
      {sheetGroup && sheetPerson && (
        <div className="assign-sheet on" data-testid="assign-sheet" role="dialog" aria-label="Choose a room">
          <header><strong>Assign {sheetPerson.name}</strong><button type="button" className="linkbtn" onClick={() => setSheet(null)}>Close</button></header>
          <ul>
            {sheetGroup.rooms.map(room => (
              <li key={room.id}>
                <button type="button" className="btn" disabled={busy || room.empty === 0} onClick={() => move(sheetGroup, sheetPerson.person_id, room.id)}>
                  {room.number} · sleeps {room.capacity} · {room.empty} empty
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
