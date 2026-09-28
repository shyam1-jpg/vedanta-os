"use client";
/** No-login stay link: diet and access, then digital check-in when the house has switched it on. */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import AllergenFields from "@/components/AllergenFields";

type Welcome = { room: string | null; note: string; keys: string; seva?: string[] };
type SevaSlot = {
  id: string; name: string; date: string; start: string; bookable: boolean; label: string;
  waiver_required: boolean; waiver: string; tasks: string[]; kind: string;
  animals: { id: string; name: string }[];
};
type Loaded = {
  given_name: string;
  group_name: string;
  arrival: string;
  allergens: string[];
  needs_access: boolean;
  complete: boolean;
  check_in: { enabled: boolean; open: boolean; from: string; id_required: boolean; rules: string; status: string; done: boolean };
  welcome: Welcome | null;
  seva?: { slots: SevaSlot[]; mine: { slot_id: string; status: string }[] };
  shuttle?: string;
  reports?: { id: string; category: string; room: string; status: string; ask: boolean }[];
};

export default function ArriveForm() {
  const [token, setToken] = useState("");
  const [page, setPage] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [severity, setSeverity] = useState("");
  const [notes, setNotes] = useState("");
  const [access, setAccess] = useState(false);
  const [arrivalTime, setArrivalTime] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [rules, setRules] = useState(false);
  const [idSeen, setIdSeen] = useState(false);
  const [age, setAge] = useState("");
  const [waiver, setWaiver] = useState(false);
  const [hygiene, setHygiene] = useState(false);
  const [animal, setAnimal] = useState("");
  const [mode, setMode] = useState("shuttle");
  const [train, setTrain] = useState("");
  const [wheelchair, setWheelchair] = useState(false);
  const [shuttleNote, setShuttleNote] = useState("");
  const [problem, setProblem] = useState("");
  const [category, setCategory] = useState("water");
  const [urgent, setUrgent] = useState("wait");
  const [enter, setEnter] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (link: string) => {
    const res = await fetch(`${API}/public/journey/${encodeURIComponent(link)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.detail ?? "This link is not valid");
    setPage(body);
    setAccess(!!body.needs_access);
    if (body.shuttle) setShuttleNote(body.shuttle);
    if (body.welcome) setWelcome(body.welcome);
  };

  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(link);
    if (!link) { setErr("This link is missing its code"); return; }
    load(link).catch(e => setErr((e as Error).message));
  }, []);

  const saveDetails = async (nothing: boolean) => {
    if (!nothing && picked.length && !severity) { setErr("Say how serious the allergy is"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/journey/${encodeURIComponent(token)}/details`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nothing ? { allergens: [], needs_access: access } : { allergens: picked, severity, diet_notes: notes, needs_access: access }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "That could not be saved");
      await load(token);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const checkIn = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/journey/${encodeURIComponent(token)}/check-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ arrival_time: arrivalTime, emergency_name: emergencyName, emergency_phone: emergencyPhone, rules_ack: rules, id_ack: idSeen }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "Check-in is not open yet");
      setWelcome(body.welcome);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const saveTravel = async (direction: "arrival" | "departure") => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/journey/${encodeURIComponent(token)}/travel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction, mode, train_time: train, access: wheelchair ? ["wheelchair"] : [] }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "That journey could not be saved");
      if (body.shuttle) setShuttleNote(body.shuttle);
      if (body.suggestion) setErr(body.suggestion);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const bookSeva = async (slotId: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/journey/${encodeURIComponent(token)}/seva`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_id: slotId, age, waiver_ack: waiver, hygiene_ack: hygiene, animal_id: animal || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "That slot could not be booked");
      await load(token);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const enRoute = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/journey/${encodeURIComponent(token)}/en-route`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "That could not be saved");
      await load(token);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="pub">
      <div className="pubcard">
        <div className="pubbrand">The Vedanta Way<br /><span>Retreat Center</span></div>
        <h1>Open My Stay</h1>
        {page && <p>{page.given_name}, this is for {page.group_name}. Arrival {page.arrival}.</p>}
        {err && <div className="note" role="alert">{err}</div>}
        {welcome && (
          <div data-testid="arrive-welcome">
            <h2>Welcome</h2>
            {welcome.room ? <p>Your room is {welcome.room}.</p> : <p>{welcome.note}</p>}
            <p>{welcome.keys}</p>
            {!!welcome.seva?.length && (
              <div data-testid="arrive-seva-welcome">
                <h3>Your seva</h3>
                <ul>{welcome.seva.map(line => <li key={line}>{line}</li>)}</ul>
              </div>
            )}
            <section data-testid="arrive-problem">
              <h2>Report a problem</h2>
              <p className="m">Room {welcome.room || "not assigned yet"}. The house sees this on the maintenance list.</p>
              <label>What is it
                <select aria-label="Problem category" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="water">Water or leak</option>
                  <option value="heating">Heating</option>
                  <option value="electrics">Electrics or lights</option>
                  <option value="furniture">Furniture</option>
                  <option value="cleanliness">Cleanliness</option>
                  <option value="noise">Noise</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>What happened<textarea aria-label="Problem" rows={3} value={problem} onChange={e => setProblem(e.target.value)} /></label>
              <label>How soon
                <select aria-label="Urgency" value={urgent} onChange={e => setUrgent(e.target.value)}>
                  <option value="wait">It can wait</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="assign-check"><input type="checkbox" checked={enter} onChange={e => setEnter(e.target.checked)} /> Staff may enter the room</label>
              <label>Photo, optional<input aria-label="Problem photo" type="file" accept="image/*" onChange={e => {
                const file = e.target.files?.[0];
                if (!file) { setPhoto(null); return; }
                const reader = new FileReader();
                reader.onload = () => setPhoto(typeof reader.result === "string" ? reader.result : null);
                reader.readAsDataURL(file);
              }} /></label>
              <button className="btn" type="button" disabled={busy} onClick={async () => {
                setBusy(true); setErr(null);
                try {
                  const res = await fetch(`${API}/public/journey/${encodeURIComponent(token)}/problem`, {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ category, description: problem, urgency: urgent, enter, photo }),
                  });
                  const body = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(body?.detail ?? "That could not be sent");
                  setProblem("");
                  await load(token);
                } catch (e) { setErr((e as Error).message); }
                finally { setBusy(false); }
              }}>Send to the house</button>
              <ul>
                {(page?.reports ?? []).map(item => (
                  <li key={item.id}>{item.category} · room {item.room} · {item.status}
                    {item.ask && <button className="btn" type="button" onClick={async () => {
                      await fetch(`${API}/public/journey/${encodeURIComponent(token)}/problem/${item.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sorted: true }) });
                      await load(token);
                    }}>It was sorted</button>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
        {page && !welcome && (
          <>
            <h2>Diet and access</h2>
            {page.complete && <p>Your details are already in. Save again only if something has changed.</p>}
            <AllergenFields choices={page.allergens} picked={picked} setPicked={setPicked} severity={severity} setSeverity={setSeverity} notes={notes} setNotes={setNotes} access={access} setAccess={setAccess} />
            <div className="actions">
              <button className="btn primary" type="button" disabled={busy} onClick={() => saveDetails(false)}>Save my details</button>
              <button className="btn" type="button" disabled={busy} onClick={() => saveDetails(true)}>Nothing to declare</button>
              {page.complete && <button className="btn" type="button" disabled={busy} onClick={() => saveDetails(true)}>These details are still right</button>}
            </div>
            <section data-testid="arrive-travel">
              <h2>Getting here</h2>
              {shuttleNote && <p>{shuttleNote}</p>}
              <label>How you are travelling
                <select aria-label="Travel mode" value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="shuttle">Shuttle from the station</option>
                  <option value="own_car">Own car</option>
                  <option value="taxi">Taxi</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label>Train time<input aria-label="Train time" value={train} onChange={e => setTrain(e.target.value)} placeholder="15:20" /></label>
              <label className="assign-check"><input type="checkbox" checked={wheelchair} onChange={e => setWheelchair(e.target.checked)} /> Wheelchair or step-free help</label>
              <div className="actions">
                <button className="btn" type="button" disabled={busy} onClick={() => saveTravel("arrival")}>Save arrival</button>
                <button className="btn" type="button" disabled={busy} onClick={() => saveTravel("departure")}>Save departure</button>
              </div>
            </section>
            {!!page.seva?.slots?.length && (
              <section data-testid="arrive-seva">
                <h2>Seva</h2>
                <label>Your age<input aria-label="Age" value={age} onChange={e => setAge(e.target.value)} /></label>
                {page.seva.slots.map(slot => (
                  <div key={slot.id}>
                    <p>{slot.name} · {slot.date} {slot.start}</p>
                    <p className="m">{slot.bookable ? slot.tasks.join(", ") : "Unsupervised: not bookable"}</p>
                    {slot.kind === "cow_care" && (
                      <label>Animal
                        <select aria-label="Animal" value={animal} onChange={e => setAnimal(e.target.value)}>
                          <option value="">Choose…</option>
                          {slot.animals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </label>
                    )}
                    {slot.kind === "kitchen_help" && <label className="assign-check"><input type="checkbox" checked={hygiene} onChange={e => setHygiene(e.target.checked)} /> I have read the food hygiene briefing</label>}
                    {slot.waiver_required && <label className="assign-check"><input type="checkbox" checked={waiver} onChange={e => setWaiver(e.target.checked)} /> {slot.waiver}</label>}
                    <button className="btn" type="button" disabled={busy || !slot.bookable} onClick={() => bookSeva(slot.id)}>
                      {page.seva?.mine.some(row => row.slot_id === slot.id) ? "Booked" : "Book this slot"}
                    </button>
                  </div>
                ))}
              </section>
            )}
            {page.check_in.enabled && (
              <section className="assign-guest" data-testid="arrive-checkin">
                <h2>Check in</h2>
                {!page.check_in.open && <p>Check-in opens at {page.check_in.from} on arrival day.</p>}
                {page.check_in.open && (
                  <>
                    <label>Arrival time<input aria-label="Arrival time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)} placeholder="15:30" /></label>
                    <label>Emergency contact, optional<input aria-label="Emergency contact name" value={emergencyName} onChange={e => setEmergencyName(e.target.value)} /></label>
                    <label>Their phone<input aria-label="Emergency contact phone" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} /></label>
                    <p className="m">An emergency contact is kept only for a short time after you leave.</p>
                    <pre className="m" style={{ whiteSpace: "pre-wrap" }}>{page.check_in.rules}</pre>
                    <label className="assign-check"><input type="checkbox" checked={rules} onChange={e => setRules(e.target.checked)} /> I have read the house notes</label>
                    {page.check_in.id_required && <label className="assign-check"><input type="checkbox" checked={idSeen} onChange={e => setIdSeen(e.target.checked)} /> I will bring identification</label>}
                    <div className="actions">
                      <button className="btn" type="button" disabled={busy} onClick={enRoute}>I am on my way</button>
                      <button className="btn primary" type="button" disabled={busy} onClick={checkIn}>Check in</button>
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
