"use client";
import { useEffect, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const tok = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem("vedanta.guest.token")),
  set: (t: string | null) => { if (t) sessionStorage.setItem("vedanta.guest.token", t); else sessionStorage.removeItem("vedanta.guest.token"); },
};
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) };
  const t = tok.get(); if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(API + path, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? res.statusText);
  return body as T;
}

type Prop = { name: string; kicker: string; tagline: string; about: string; website: string; company: string; address: string; check_in_from: string; check_out_by: string; rooms: number };
type Prog = { id: string; name: string; kind: string; basis: string | null; arrival: string; arrival_time: string | null; departure: string; departure_time: string | null; nights: number; places: number | null; spa: boolean; meals: boolean; package: string | null; price: string | null; about: string | null };
type Room = { number: string; section: string | null };
type RoomType = { code: string; name: string; sleeps: number; accessible: boolean; beds: string; features: string[]; total: number; available: number };
type Avail = { arrival: string; departure: string; nights: number; free_rooms: number; types: RoomType[]; rooms: { number: string; section: string | null; type_name: string; sleeps: number; beds: string; feature_labels: string[]; accessible: boolean }[] };
type Day = { date: string; free_rooms: number };
type Mine = { id: string; people: number; arrival: string; departure: string; status: string; programme_name: string | null; notes: string | null; dietary_notes: string | null; accessibility_notes: string | null; arrival_time_note: string | null; travel_notes: string | null; rooms: Room[] };
type Me = { name: string; email: string };
type GuestAsk = { id: string; room_label: string | null; department_label: string; request_text: string; status: string };
type Step = "browse" | "room" | "details" | "needs" | "pay" | "done";

const fmt = (d: string) => {
  const x = new Date(d + "T12:00:00");
  return x.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const nights = (p: Prog) => p.nights === 1 ? "1 night" : p.nights > 1 ? `${p.nights} nights` : "Day retreat";
const STEPS: { id: Step; label: string }[] = [
  { id: "browse", label: "Programme" },
  { id: "room", label: "Room" },
  { id: "details", label: "Your details" },
  { id: "needs", label: "Diet & access" },
  { id: "pay", label: "Review" },
  { id: "done", label: "Enquiry sent" },
];

const photo = (file: string) => `/book/images/${file}`;
const GALLERY: { file: string; title: string; caption: string; alt: string; wide?: boolean }[] = [
  { file: "house-aerial.jpg", title: "The house", caption: "The retreat house and grounds.", alt: "Aerial view of the retreat house and grounds", wide: true },
  { file: "dining-room.jpg", title: "Dining hall", caption: "Buffet-only, and pure vegetarian.", alt: "The dining hall laid for a buffet", },
  { file: "food.jpg", title: "From the kitchen", caption: "No eggs, and no onion, garlic or other onion-family ingredients.", alt: "A vegetarian dish", },
  { file: "lounge.jpg", title: "Guest lounge", caption: "The guest lounge.", alt: "The guest lounge", },
  { file: "lake.jpg", title: "The grounds", caption: "A lake in the grounds.", alt: "A lake in the grounds", },
];

function StayNeedsEditor({ stay, onSaved }: { stay: Mine; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needs, setNeeds] = useState({
    dietary_notes: stay.dietary_notes ?? "", accessibility_notes: stay.accessibility_notes ?? "",
    arrival_time_note: stay.arrival_time_note ?? "", travel_notes: stay.travel_notes ?? "",
  });
  const set = (key: keyof typeof needs, value: string) => setNeeds(s => ({ ...s, [key]: value }));
  if (stay.status === "DECLINED" || stay.departure < new Date().toISOString().slice(0, 10)) return null;
  return <div className="stay-needs">
    <button className="btn sec" type="button" onClick={() => { setEditing(!editing); setMessage(""); }}>{editing ? "Close details" : "Update diet, access & arrival"}</button>
    {editing && <div>
      <p className="m">Please describe allergies clearly. The house will review changes with the kitchen; a request is not an allergy clearance.</p>
      <label>Diet and allergies<textarea maxLength={2000} rows={2} value={needs.dietary_notes} onChange={e => set("dietary_notes", e.target.value)} /></label>
      <label>Accessibility needs<textarea maxLength={2000} rows={2} value={needs.accessibility_notes} onChange={e => set("accessibility_notes", e.target.value)} /></label>
      <label>Expected arrival time<input maxLength={2000} value={needs.arrival_time_note} onChange={e => set("arrival_time_note", e.target.value)} /></label>
      <label>Travel or pickup<textarea maxLength={2000} rows={2} value={needs.travel_notes} onChange={e => set("travel_notes", e.target.value)} /></label>
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true); setMessage("");
        try {
          await api(`/guest/enquiries/${stay.id}/needs`, { method: "PATCH", body: JSON.stringify(needs) });
          await onSaved(); setMessage("Your stay details have been saved for the house."); setEditing(false);
        } catch (e) { setMessage((e as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Save stay details"}</button>
    </div>}
    {message && <p className="note" role="status">{message}</p>}
  </div>;
}

export default function Book() {
  const [prop, setProp] = useState<Prop | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [programmes, setProgrammes] = useState<Prog[]>([]);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [sel, setSel] = useState<Prog | null>(null);
  const [auth, setAuth] = useState<"hidden" | "login" | "register" | "recover">("hidden");
  const [step, setStep] = useState<Step>("browse");
  const [form, setForm] = useState({
    name: "", email: "", access_code: "", people: "1", arrival: "", departure: "", notes: "",
    dietary_notes: "", accessibility_notes: "", room_preference: "", arrival_time_note: "", travel_notes: "",
  });
  const [avail, setAvail] = useState<Avail | null>(null);
  const [cal, setCal] = useState<Day[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asks, setAsks] = useState<GuestAsk[]>([]);
  const [ask, setAsk] = useState({ request_text: "", room_label: "" });
  const [bedPreference, setBedPreference] = useState("any");
  const [accessibleOnly, setAccessibleOnly] = useState(false);

  const loadPublic = async () => {
    const [p, progs] = await Promise.all([
      api<Prop>("/guest/property"),
      api<{ items: Prog[] }>("/guest/programmes"),
    ]);
    setProp(p);
    setProgrammes(progs.items);
  };

  const loadSigned = async () => {
    const u = await api<Me>("/guest/me");
    setMe(u);
    setForm(f => ({ ...f, name: u.name, email: u.email }));
    const [enqs, reqs] = await Promise.all([
      api<{ items: Mine[] }>("/guest/enquiries"),
      api<{ items: GuestAsk[] }>("/guest/requests").catch(() => ({ items: [] as GuestAsk[] })),
    ]);
    setMine(enqs.items);
    setAsks(reqs.items);
  };

  useEffect(() => {
    loadPublic().catch(() => {});
    if (tok.get()) loadSigned().catch(() => tok.set(null));
  }, []);

  const searchDates = async (arrival = form.arrival, departure = form.departure) => {
    setAvail(null);
    if (!arrival || !departure || departure <= arrival) { setErr("Choose a departure after your arrival date."); return; }
    setBusy(true); setErr(null);
    try {
      const a = await api<Avail>(`/guest/availability?arrival=${arrival}&departure=${departure}&people=${form.people}`);
      setAvail(a);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 28);
    const f = from.toISOString().slice(0, 10); const t = to.toISOString().slice(0, 10);
    api<{ days: Day[] }>(`/guest/calendar?from=${f}&to=${t}`).then(r => setCal(r.days)).catch(() => {});
  }, []);

  const pickProgramme = (p: Prog) => {
    setSel(p);
    setForm(f => ({ ...f, arrival: p.arrival, departure: p.departure }));
    setStep("room");
    setOk(null); setErr(null);
    searchDates(p.arrival, p.departure);
  };

  const matchingTypes = (avail?.types ?? []).filter(t =>
    t.available > 0 && t.sleeps >= Number(form.people) &&
    (!accessibleOnly || t.accessible) && (bedPreference === "any" || t.beds.toLowerCase().includes(bedPreference))
  );

  const doRegister = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<{ token: string; user: Me; access_code?: string | null }>("/guest/register", {
        method: "POST", body: JSON.stringify({ name: form.name, email: form.email }),
      });
      tok.set(r.token);
      setForm(f => ({ ...f, access_code: r.access_code ?? f.access_code ?? "" }));
      await loadSigned();
      setAuth("hidden");
      setOk(r.access_code
        ? `Welcome. Your private access code is ${r.access_code}. It expires in 14 days. Write it down.`
        : "Welcome back.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const doLogin = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<{ token: string }>("/guest/login", {
        method: "POST", body: JSON.stringify({ email: form.email, access_code: form.access_code }),
      });
      tok.set(r.token); await loadSigned(); setAuth("hidden");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const doRecover = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<{ detail: string }>("/guest/recover", { method: "POST", body: JSON.stringify({ email: form.email, name: form.name }) });
      setOk(r.detail);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const doEnquiry = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<{ token: string; user: Me; access_code?: string | null; id: string; status: string }>("/guest/enquiries", {
        method: "POST", body: JSON.stringify({
          name: form.name, email: form.email, people: Number(form.people), notes: form.notes,
          dietary_notes: form.dietary_notes, accessibility_notes: form.accessibility_notes,
          room_preference: form.room_preference, arrival_time_note: form.arrival_time_note, travel_notes: form.travel_notes,
          ...(sel ? { programme_id: sel.id } : { arrival: form.arrival, departure: form.departure }),
        }),
      });
      tok.set(r.token);
      if (r.access_code) setForm(f => ({ ...f, access_code: r.access_code ?? "" }));
      await loadSigned();
      setStep("done");
      setOk(r.access_code
        ? `Enquiry sent. Your private access code is ${r.access_code}. It expires in 14 days. Write it down.`
        : "Your enquiry is with the house. They will confirm availability and terms.");
      return r;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(false); }
  };

  const signOut = () => { tok.set(null); setMe(null); setMine(null); setSel(null); setStep("browse"); setOk(null); setErr(null); };

  return (
    <>
      <header className="top">
        <div className="mark">Retreat Center · The Vedanta Way</div>
        <div className="who">
          {me
            ? <>{me.name} · My Stay · <button onClick={signOut}>Sign out</button></>
            : <>
              <button onClick={() => { setAuth("login"); setOk(null); setErr(null); }}>Sign in</button>{" "}
              <button onClick={() => { setAuth("register"); setOk(null); setErr(null); }}>Open My Stay</button>
            </>}
        </div>
      </header>

      <section className="hero" aria-label={prop?.name ?? "The Vedanta Way"}>
        <div className="hero-inner">
          <div className="kicker">{prop?.kicker ?? "Retreat Center"}</div>
          <h1>{prop?.name ?? "The Vedanta Way"}</h1>
          <p className="tag">{prop?.tagline ?? "Luxury retreat centre"}</p>
          {prop?.about && <p className="about">{prop.about}</p>}
          <a className="hero-cta" href="#open-retreats">Browse open retreats</a>
        </div>
      </section>

      <div className="band">
        <div className="wrap">
          <div className="facts">
            <div><b>{prop?.check_in_from ?? "15:00"}</b><span>Check-in from</span></div>
            <div><b>{prop?.check_out_by ?? "11:00"}</b><span>Check-out by</span></div>
            <div><b>{prop?.rooms ?? 41}</b><span>Guest rooms</span></div>
          </div>

          <section className="gallery" aria-label="The house and grounds">
            <p className="section-kicker">The house</p>
            <h2>House, table and grounds</h2>
            <p className="lead">The restaurant is buffet-only and pure vegetarian — no eggs, and no onion, garlic or other onion-family ingredients.</p>
            <div className="gallery-grid">
              {GALLERY.map(g => (
                <figure key={g.file} className={g.wide ? "shot wide" : "shot"}>
                  <img src={photo(g.file)} alt={g.alt} />
                  <figcaption>
                    <strong>{g.title}</strong>
                    <span>{g.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="goshala">A goshala on the grounds is home to two cows, Hari and Lakshmi, for care and seva.</p>
          </section>

          <section className="experience" aria-label="Dining experience">
            <img src={photo("guest-dining-concept.webp")} alt="Illustration of guests enjoying a vegetarian buffet at a retreat" loading="lazy" />
            <div className="experience-copy">
              <p className="section-kicker">At the table</p>
              <h2>Food made for your retreat</h2>
              <p>Enjoy vegetarian buffet meals together. Tell the house about vegan, Jain, gluten-free and allergy needs when you enquire, then update your details in My Stay.</p>
              <small>Illustrative image · Guest experience concept</small>
            </div>
          </section>

          {auth !== "hidden" && !me && (
            <div className="card" style={{ maxWidth: 480, marginBottom: 28 }}>
              <h2 style={{ fontSize: 26 }}>{auth === "recover" ? "Access code help" : auth === "register" ? "Open My Stay" : "Sign in to My Stay"}</h2>
              <p className="m">{auth === "recover"
                ? "We will not tell you whether an email is on the book. If it is, the house will help."
                : auth === "register"
                  ? "Registration is only needed when you save a booking. Browse first if you prefer."
                  : "Email and the 6-digit code from when you first booked."}</p>
              {auth === "register" && <>
                <label htmlFor="g-name">Your name</label>
                <input id="g-name" autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </>}
              <label htmlFor="g-email">Email</label>
              <input id="g-email" type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              {auth === "login" && <>
                <label htmlFor="g-code">Access code</label>
                <input id="g-code" inputMode="numeric" placeholder="6-digit code" value={form.access_code} onChange={e => setForm({ ...form, access_code: e.target.value })} />
              </>}
              <button className="btn" disabled={busy} onClick={auth === "recover" ? doRecover : auth === "register" ? doRegister : doLogin}>
                {busy ? "…" : auth === "recover" ? "Ask the house" : auth === "register" ? "Create My Stay" : "Open My Stay"}
              </button>
              {auth === "login" && <button className="btn sec" onClick={() => { setAuth("recover"); setErr(null); setOk(null); }}>I cannot use my code</button>}
              <button className="btn sec" onClick={() => { setAuth(auth === "login" ? "register" : "login"); setErr(null); setOk(null); }}>
                {auth === "login" || auth === "recover" ? "I need to register" : "I already have My Stay"}
              </button>
              {ok && <div className="note">{ok}</div>}
              {err && <div className="note">{err}</div>}
            </div>
          )}

          <div className="split">
            <div>
              <h2 id="open-retreats">Open retreats</h2>
              <p className="lead">Browse programmes, dates and rooms before you create an account. Send an enquiry when you are ready.</p>
              <div className="grid">
                {programmes.length === 0 && <p className="m">No published retreats right now. Search your own dates — the house still has rooms to offer.</p>}
                {programmes.map(p => (
                  <button key={p.id} className={"prog" + (sel?.id === p.id ? " on" : "")} onClick={() => pickProgramme(p)}>
                    <div className="k">{p.kind}</div>
                    <h3>{p.name}</h3>
                    <div className="d">{fmt(p.arrival)} → {fmt(p.departure)} · {nights(p)}{p.price ? ` · ${p.price}` : ""}</div>
                  </button>
                ))}
              </div>

              <h2 style={{ marginTop: 36 }}>Availability</h2>
              <p className="lead">Rooms free each night for the next four weeks. Select an arrival day, then check the full stay.</p>
              <div className="cal">
                {cal.map(d => (
                  <button key={d.date} type="button" aria-label={`${fmt(d.date)}: ${d.free_rooms} rooms free`} aria-pressed={form.arrival === d.date}
                    className={"cal-d" + (d.free_rooms === 0 ? " none" : "") + (form.arrival === d.date ? " selected" : "")} onClick={() => {
                    const next = new Date(d.date + "T12:00:00"); next.setDate(next.getDate() + 2);
                    const dep = next.toISOString().slice(0, 10);
                    setSel(null);
                    setForm(f => ({ ...f, arrival: d.date, departure: dep }));
                    setStep("room");
                    searchDates(d.date, dep);
                  }}>
                    <b>{new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</b>
                    <span>{d.free_rooms} rooms</span>
                  </button>
                ))}
              </div>
            </div>

            <aside>
              <div className="steps" aria-label="Booking steps">
                {STEPS.map(s => <span key={s.id} className={STEPS.findIndex(x => x.id === step) >= STEPS.findIndex(x => x.id === s.id) ? "done" : ""}>{s.label}</span>)}
              </div>

              <div className="card">
                <h2 style={{ fontSize: 24 }}>{sel ? sel.name : "Your dates"}</h2>
                {sel && <p className="m">{fmt(sel.arrival)} → {fmt(sel.departure)} · {nights(sel)}{sel.basis ? ` · ${sel.basis}` : ""}</p>}
                {sel?.about && <p className="copy">{sel.about}</p>}
                <label>Arrive</label>
                <input type="date" value={form.arrival} onChange={e => { setForm({ ...form, arrival: e.target.value, room_preference: "" }); setSel(null); setAvail(null); }} />
                <label>Depart</label>
                <input type="date" min={form.arrival || undefined} value={form.departure} onChange={e => { setForm({ ...form, departure: e.target.value, room_preference: "" }); setAvail(null); }} />
                <label>How many people</label>
                <input type="number" min={1} max={41} value={form.people} onChange={e => { setForm({ ...form, people: e.target.value, room_preference: "" }); setAvail(null); }} />
                <button className="btn sec" disabled={busy} onClick={() => { setStep("room"); searchDates(); }}>Show rooms</button>
                {avail && (
                  <div className="rooms" style={{ display: "block", marginTop: 16 }}>
                    <p className="m"><b>{avail.free_rooms}</b> rooms free · {avail.nights} {avail.nights === 1 ? "night" : "nights"}</p>
                    <label htmlFor="bed-preference">Preferred bed</label>
                    <select id="bed-preference" value={bedPreference} onChange={e => setBedPreference(e.target.value)}>
                      <option value="any">Any bed setup</option><option value="single">Single beds</option><option value="double">Double bed</option><option value="king">King bed</option>
                    </select>
                    <label className="check"><input type="checkbox" checked={accessibleOnly} onChange={e => setAccessibleOnly(e.target.checked)} /> Accessible rooms only</label>
                    {matchingTypes.length === 0 && <p className="m">No rooms match these preferences. Try a different bed setup, number of people or dates.</p>}
                    {matchingTypes.map(t => (
                      <button key={t.code + t.sleeps + String(t.accessible)} className={"room-type" + (form.room_preference === t.name ? " on" : "")} onClick={() => { setForm(f => ({ ...f, room_preference: t.name })); setStep("details"); }}>
                        <b>{t.name}</b>
                        <span>{t.available} of {t.total} free · sleeps {t.sleeps}{t.accessible ? " · accessible" : ""}{t.beds ? ` · ${t.beds}` : ""}</span>
                      </button>
                    ))}
                    <p className="m">Room preference is a request until the house confirms your allocation. The total price and deposit will be confirmed by the house before payment.</p>
                  </div>
                )}
              </div>

              {(step === "details" || step === "needs" || step === "pay" || step === "done") && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Guest details</h2>
                  <p className="m">This is when we open My Stay / Guest Portal for you.</p>
                  <label>Your name</label>
                  <input autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  <label>Email</label>
                  <input type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                  <button className="btn sec" onClick={() => setStep("needs")}>Continue to diet & access</button>
                </div>
              )}

              {(step === "needs" || step === "pay" || step === "done") && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Diet, access and arrival</h2>
                  <label>Dietary requirements</label>
                  <p className="hint">Buffet-only and pure vegetarian: no eggs, and no onion, garlic or other onion-family ingredients.</p>
                  <textarea rows={2} value={form.dietary_notes} onChange={e => setForm({ ...form, dietary_notes: e.target.value })} placeholder="Vegan, Jain, gluten-free, allergies…" />
                  <label>Accessibility</label>
                  <textarea rows={2} value={form.accessibility_notes} onChange={e => setForm({ ...form, accessibility_notes: e.target.value })} />
                  <label>Expected arrival time</label>
                  <input value={form.arrival_time_note} onChange={e => setForm({ ...form, arrival_time_note: e.target.value })} placeholder="e.g. 16:30 from Lincoln station" />
                  <label>Travel / pickup</label>
                  <textarea rows={2} value={form.travel_notes} onChange={e => setForm({ ...form, travel_notes: e.target.value })} placeholder="Train, taxi, self-drive…" />
                  <label>Anything else</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                  <button className="btn sec" onClick={() => setStep("pay")}>Continue to deposit</button>
                </div>
              )}

              {step === "pay" && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Review your enquiry</h2>
                  <p className="m">The house will confirm the full price, deposit amount, payment instructions and cancellation terms before asking you to pay. Sending this enquiry does not charge you or guarantee a room.</p>
                  <p className="m"><b>Stay:</b> {form.arrival ? fmt(form.arrival) : "—"} → {form.departure ? fmt(form.departure) : "—"} · {form.people} {Number(form.people) === 1 ? "guest" : "guests"}</p>
                  <p className="m"><b>Room requested:</b> {form.room_preference || "House to advise"}</p>
                  {sel?.price && <p className="m"><b>Published price note:</b> {sel.price}</p>}
                  <button className="btn sec" style={{ marginTop: 10 }} disabled={busy || !form.name || !form.email.includes("@")} onClick={doEnquiry}>
                    {busy ? "…" : "Send booking enquiry"}
                  </button>
                  {ok && <div className="note">{ok}</div>}
                  {err && <div className="note">{err}</div>}
                </div>
              )}

              {me && mine && mine.length > 0 && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>My Stay</h2>
                  <p className="m">Guest Portal — only you can see this.</p>
                  {mine.map(x => (
                    <div className="row" key={x.id} style={{ display: "block" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span>{x.programme_name ?? "Your dates"} · {fmt(x.arrival)} → {fmt(x.departure)} · {x.people} {Number(x.people) === 1 ? "person" : "people"}</span>
                        <span className="m">{x.status === "CONVERTED" ? "in the house book" : x.status.toLowerCase()}</span>
                      </div>
                      {x.rooms?.length
                        ? <div className="rooms">{x.rooms.map(r => <span key={r.number} className="room">{r.number}{r.section ? ` · ${r.section}` : ""}</span>)}</div>
                        : <p className="m" style={{ margin: "8px 0 0" }}>Rooms appear when the house assigns them.</p>}
                      <StayNeedsEditor stay={x} onSaved={async () => setMine((await api<{ items: Mine[] }>("/guest/enquiries")).items)} />
                    </div>
                  ))}
                </div>
              )}

              {me && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 20 }}>Need something from the house?</h2>
                  <p className="m">Towels, a taxi, a meal note — it goes to the right team.</p>
                  <label>Your request</label>
                  <textarea rows={3} value={ask.request_text} onChange={e => setAsk({ ...ask, request_text: e.target.value })} placeholder="e.g. Extra towels in my room" />
                  <label>Room (optional)</label>
                  <input value={ask.room_label} onChange={e => setAsk({ ...ask, room_label: e.target.value })} placeholder={(mine ?? []).flatMap(x => x.rooms ?? []).map(r => r.number).join(", ") || "e.g. 110"} />
                  <button className="btn" disabled={busy} onClick={async () => {
                    setBusy(true); setErr(null); setOk(null);
                    try {
                      await api("/guest/requests", { method: "POST", body: JSON.stringify(ask) });
                      setAsk({ request_text: "", room_label: ask.room_label });
                      setAsks((await api<{ items: GuestAsk[] }>("/guest/requests")).items);
                      setOk("The house has your request.");
                    } catch (e) { setErr((e as Error).message); }
                    finally { setBusy(false); }
                  }}>{busy ? "…" : "Send to the house"}</button>
                  {asks.map(a => (
                    <div className="row" key={a.id} style={{ display: "block" }}>
                      <span>{a.request_text}</span>
                      <div className="m">{a.department_label}{a.room_label ? ` · ${a.room_label}` : ""} · {a.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>

          <section className="trust">
            <h2>Before you book</h2>
            <div className="facts">
              <div><b>Check-in / out</b><span>Arrive from {prop?.check_in_from ?? "15:00"}. Rooms ready for the evening. Leave by {prop?.check_out_by ?? "11:00"}.</span></div>
              <div><b>Price & deposit</b><span>The house will quote the full price and deposit before payment. Sending an enquiry does not charge you.</span></div>
              <div><b>Cancellation</b><span>The house will provide the applicable refund and cancellation terms before you make a payment.</span></div>
              <div><b>Meals & diet</b><span>The restaurant is buffet-only and pure vegetarian: no eggs, and no onion, garlic or other onion-family ingredients. Tell us vegan, Jain, gluten-free or allergies on the form.</span></div>
              <div><b>Accessibility</b><span>Tell us if you need a ground-floor or accessible room when you send your enquiry.</span></div>
              <div><b>Privacy & support</b><span>Your stay is private. Write to reception at the house, or use access-code help if you cannot sign in.</span></div>
            </div>
          </section>
        </div>
      </div>
      <footer className="foot">
        {prop?.name ?? "The Vedanta Way"} · {prop?.company ?? "The Vedanta Way Ltd"} · {prop?.address}<br />
        <a href={prop?.website ?? "https://www.thevedanta.org/"}>{(prop?.website ?? "https://www.thevedanta.org/").replace(/^https?:\/\//, "")}</a>
        {" · "}<a href="/sign-in/">Staff</a>
      </footer>
    </>
  );
}
