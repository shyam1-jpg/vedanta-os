"use client";
import { useEffect, useState } from "react";
import PhotoGallery from "@/components/PhotoGallery";
import HearFromUs from "@/components/HearFromUs";
import LostReport from "@/components/LostReport";
import SustainabilityNote from "@/components/SustainabilityNote";
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
type Mine = { id: string; people: number; arrival: string; departure: string; status: string; programme_name: string | null; notes: string | null; rooms: Room[]; deposit_status?: string; deposit_amount?: number | null };
type Me = { name: string; email: string };
type GuestAsk = { id: string; room_label: string | null; department_label: string; request_text: string; status: string };
type AllergenTick = { code: string; severity: string };
type PartyPerson = { given_name: string; family_name: string; diet: string[]; allergens: AllergenTick[]; other: string; accessibility: string; plate: string };
type Step = "browse" | "room" | "details" | "needs" | "pay" | "done";
const ALLERGENS: [string, string][] = [
  ["celery", "Celery"], ["cereals_gluten", "Gluten"], ["crustaceans", "Crustaceans"], ["eggs", "Eggs"],
  ["fish", "Fish"], ["lupin", "Lupin"], ["milk", "Milk"], ["molluscs", "Molluscs"], ["mustard", "Mustard"],
  ["nuts", "Tree nuts"], ["peanuts", "Peanuts"], ["sesame", "Sesame"], ["soya", "Soya"], ["sulphites", "Sulphites"],
];
const DIETS: [string, string][] = [["vegan", "Vegan"], ["jain", "Jain — no root vegetables"], ["gluten_free", "Gluten-free"], ["dairy_free", "Dairy-free"], ["nut_free", "Nut-free"], ["halal", "Halal"], ["kosher", "Kosher"]];
const SEVERITIES: [string, string][] = [["PREFERENCE", "Preference"], ["INTOLERANCE", "Intolerance"], ["ALLERGY", "Allergy"], ["ANAPHYLAXIS", "Anaphylaxis — severe"]];
function blankPerson(name = ""): PartyPerson {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { given_name: parts[0] ?? "", family_name: parts.slice(1).join(" "), diet: [], allergens: [], other: "", accessibility: "", plate: "buffet" };
}

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
  { id: "pay", label: "Deposit" },
  { id: "done", label: "Confirmation" },
];

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
    dietary_notes: "", accessibility_notes: "", room_preference: "", arrival_time_note: "", travel_notes: "", keep_allergens: false,
  });
  const [avail, setAvail] = useState<Avail | null>(null);
  const [cal, setCal] = useState<Day[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentsOn, setPaymentsOn] = useState(false);
  const [booking, setBooking] = useState<{ open: boolean; detail: string; contact: string | null; website: string | null; deposit_gbp: number; deposit_policy: string }>({ open: true, detail: "", contact: null, website: null, deposit_gbp: 200, deposit_policy: "The house agrees the deposit when your place is accepted. Food is not billed." });
  const [savedEnquiryId, setSavedEnquiryId] = useState<string | null>(null);
  const [asks, setAsks] = useState<GuestAsk[]>([]);
  const [ask, setAsk] = useState({ request_text: "", room_label: "" });
  const [party, setParty] = useState<PartyPerson[]>([blankPerson()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<{ href: string | null; check_in: boolean } | null>(null);

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
    api<{ href: string | null; check_in: boolean }>("/guest/check-in").then(setCheckIn).catch(() => setCheckIn(null));
  };

  useEffect(() => {
    loadPublic().catch(() => {});
    if (tok.get()) loadSigned().catch(() => tok.set(null));
  }, []);

  const searchDates = async (arrival = form.arrival, departure = form.departure) => {
    if (!arrival || !departure || departure < arrival) { setAvail(null); return; }
    setBusy(true); setErr(null);
    try {
      const a = await api<Avail>(`/guest/availability?arrival=${arrival}&departure=${departure}&people=${form.people}`);
      setAvail(a);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const n = Math.max(1, Math.min(80, Number(form.people) || 1));
    setParty(prev => {
      if (prev.length === n) return prev;
      const next = prev.slice(0, n);
      while (next.length < n) next.push(blankPerson(next.length === 0 ? form.name : ""));
      return next;
    });
  }, [form.people]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 28);
    const f = from.toISOString().slice(0, 10); const t = to.toISOString().slice(0, 10);
    api<{ days: Day[] }>(`/guest/calendar?from=${f}&to=${t}`).then(r => setCal(r.days)).catch(() => {});
    api<{ enabled: boolean }>("/guest/payments").then(r => setPaymentsOn(!!r.enabled)).catch(() => setPaymentsOn(false));
    api<{ open: boolean; detail: string; contact: string | null; website: string | null; deposit_gbp: number; deposit_policy: string; payments?: boolean }>("/guest/booking-status")
      .then(r => { setBooking({ open: r.open, detail: r.detail, contact: r.contact, website: r.website, deposit_gbp: r.deposit_gbp, deposit_policy: r.deposit_policy }); if (typeof r.payments === "boolean") setPaymentsOn(r.payments); })
      .catch(() => setBooking(b => ({ ...b, open: false, detail: "We could not check whether booking is open. Contact the house before you fill this in." })));
  }, []);

  const enquiryKey = () => {
    const existing = sessionStorage.getItem("vedanta.enquiry.key");
    if (existing) return existing;
    const next = crypto.randomUUID();
    sessionStorage.setItem("vedanta.enquiry.key", next);
    return next;
  };

  const pickProgramme = (p: Prog) => {
    if (!booking.open) return;
    setSel(p);
    setForm(f => ({ ...f, arrival: p.arrival, departure: p.departure }));
    setStep("room");
    setOk(null); setErr(null);
    searchDates(p.arrival, p.departure);
  };

  const doRegister = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<{ token?: string; user?: Me; access_code?: string | null; verification_required?: boolean; detail?: string }>("/guest/register", {
        method: "POST", body: JSON.stringify({ name: form.name, email: form.email }),
      });
      if (r.verification_required) { setAuth("login"); setOk(r.detail ?? "Sign in with the access code we sent."); return; }
      if (!r.token) throw new Error("Sign-in did not start");
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
      const status = await api<{ open: boolean; detail: string; contact: string | null; website: string | null; deposit_gbp: number; deposit_policy: string }>("/guest/booking-status");
      setBooking(status);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const doRecover = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<{ detail: string }>("/guest/recover", { method: "POST", body: JSON.stringify({ email: form.email, name: form.name }) });
      setOk(r.detail);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const readyParty = () => {
    const n = Math.max(1, Number(form.people) || 1);
    const rows = party.slice(0, n).map(p => ({ ...p, allergens: p.allergens.map(a => ({ ...a })) }));
    while (rows.length < n) rows.push(blankPerson());
    if (!rows[0].given_name.trim() && form.name.trim()) {
      const seeded = blankPerson(form.name);
      rows[0] = { ...rows[0], given_name: seeded.given_name, family_name: rows[0].family_name || seeded.family_name };
    }
    return rows;
  };

  const doEnquiry = async (opts?: { finish?: boolean }) => {
    if (!booking.open) { setErr(booking.detail || "Online booking is not open."); return null; }
    setBusy(true); setErr(null); setOk(null);
    const rows = readyParty();
    const missing = rows.findIndex(p => !p.given_name.trim() || !p.family_name.trim());
    if (missing >= 0) { setBusy(false); setErr(`Person ${missing + 1} needs a first and last name`); return null; }
    const ungraded = rows.find(p => p.allergens.some(a => !a.severity));
    if (ungraded) { setBusy(false); setErr(`Say how serious each allergen is for ${ungraded.given_name}`); return null; }
    const payload = {
      name: form.name, email: form.email, people: rows.length, notes: form.notes,
      accessibility_notes: form.accessibility_notes,
      room_preference: form.room_preference, arrival_time_note: form.arrival_time_note, travel_notes: form.travel_notes,
      keep_allergens: form.keep_allergens,
      party: rows.map(p => ({ ...p, other: p.other || null, accessibility: p.accessibility || null })),
      ...(editingId ? { arrival: form.arrival, departure: form.departure } : sel ? { programme_id: sel.id } : { arrival: form.arrival, departure: form.departure }),
    };
    try {
      const r = await api<{ token?: string; user?: Me; access_code?: string | null; id: string; status: string }>(
        editingId ? `/guest/enquiries/${editingId}` : "/guest/enquiries",
        { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload), headers: editingId ? undefined : { "idempotency-key": enquiryKey() } },
      );
      if (r.token) tok.set(r.token);
      if (r.access_code) setForm(f => ({ ...f, access_code: r.access_code ?? "" }));
      setParty(rows);
      setSavedEnquiryId(r.id);
      await loadSigned().catch(() => {});
      if (opts?.finish !== false) {
        sessionStorage.removeItem("vedanta.enquiry.key");
        setStep("done");
      }
      setEditingId(null);
      setOk(r.access_code
        ? `Saved. Your private access code is ${r.access_code}. It expires in 14 days. Write it down. Please check the allergens below.`
        : sel ? `Your place on ${sel.name} is with the house. Please check the allergens below.` : "Your enquiry is with the house. Please check the allergens below.");
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

      <section className="hero">
        <div className="kicker">{prop?.kicker ?? "Retreat Center"}</div>
        <h1>{prop?.name ?? "The Vedanta Way"}</h1>
        <p className="tag">Luxury retreat centre</p>
        <p>{prop?.about}</p>
      </section>

      <div className="band">
        <div className="wrap">
          <div className="facts">
            <div><b>{prop?.check_in_from ?? "15:00"}</b><span>Check-in from</span></div>
            <div><b>{prop?.check_out_by ?? "11:00"}</b><span>Check-out by</span></div>
            <div><b>{prop?.rooms ?? 41}</b><span>Guest rooms</span></div>
          </div>
          <PhotoGallery />
          <LostReport />
          <SustainabilityNote />

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
              <h2>Open retreats</h2>
              <p className="lead">Browse programmes, dates and rooms before you create an account. Registration happens when you save a place.</p>
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
              <p className="lead">Live free rooms for the next four weeks. Choose dates to see room types.</p>
              <div className="cal">
                {cal.map(d => (
                  <button key={d.date} className={"cal-d" + (d.free_rooms === 0 ? " none" : "")} onClick={() => {
                    if (!booking.open) return;
                    const next = new Date(d.date + "T12:00:00"); next.setDate(next.getDate() + 2);
                    const dep = next.toISOString().slice(0, 10);
                    setSel(null);
                    setForm(f => ({ ...f, arrival: d.date, departure: dep }));
                    setStep("room");
                    searchDates(d.date, dep);
                  }}>
                    <b>{new Date(d.date + "T12:00:00").getDate()}</b>
                    <span>{d.free_rooms}</span>
                  </button>
                ))}
              </div>
            </div>

            <aside>
              {!booking.open && (
                <div className="card" data-testid="booking-closed" style={{ marginBottom: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Online booking is not open</h2>
                  <p>{booking.detail}</p>
                  {booking.contact && <p><a href={`mailto:${booking.contact}`}>{booking.contact}</a></p>}
                  {!booking.contact && booking.website && <p><a href={booking.website}>Contact the house</a></p>}
                  <button className="btn" onClick={() => { setAuth("login"); setOk(null); setErr(null); }}>Sign in with an access code</button>
                  <button className="btn sec" style={{ marginLeft: 8 }} onClick={() => { setAuth("register"); setOk(null); setErr(null); }}>Email me an access code</button>
                </div>
              )}
              {booking.open && <>
              <div className="steps" aria-label="Booking steps">
                {STEPS.map(s => <span key={s.id} className={STEPS.findIndex(x => x.id === step) >= STEPS.findIndex(x => x.id === s.id) ? "done" : ""}>{s.label}</span>)}
              </div>

              <div className="card">
                <h2 style={{ fontSize: 24 }}>{sel ? sel.name : "Your dates"}</h2>
                {sel && <p className="m">{fmt(sel.arrival)} → {fmt(sel.departure)} · {nights(sel)}{sel.basis ? ` · ${sel.basis}` : ""}</p>}
                {sel?.about && <p className="copy">{sel.about}</p>}
                <label>Arrive</label>
                <input type="date" value={form.arrival} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, arrival: v })); setSel(null); }} />
                <label>Depart</label>
                <input type="date" value={form.departure} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, departure: v })); }} />
                <label>How many people</label>
                <input type="number" min={1} value={form.people} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, people: v })); }} />
                <button className="btn sec" disabled={busy} onClick={() => { setStep("room"); searchDates(); }}>Show rooms</button>
                {avail && (
                  <div className="rooms" style={{ display: "block", marginTop: 16 }}>
                    <p className="m"><b>{avail.free_rooms}</b> rooms free · {avail.nights} {avail.nights === 1 ? "night" : "nights"}</p>
                    {avail.types.map(t => (
                      <button key={t.code + t.sleeps + String(t.accessible)} className={"room-type" + (form.room_preference === t.name ? " on" : "")} onClick={() => { setForm(f => ({ ...f, room_preference: t.name })); setStep("details"); }}>
                        <b>{t.name}</b>
                        <span>{t.available} of {t.total} free · sleeps {t.sleeps}{t.accessible ? " · accessible" : ""}{t.beds ? ` · ${t.beds}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(step === "details" || step === "needs" || step === "pay" || step === "done") && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Guest details</h2>
                  <p className="m">This is when we open My Stay / Guest Portal for you.</p>
                  <label>Your name</label>
                  <input autoComplete="name" value={form.name} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, name: v })); }} />
                  <label>Email</label>
                  <input type="email" autoComplete="email" value={form.email} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, email: v })); }} />
                  <button className="btn sec" onClick={() => { setParty(readyParty()); setStep("needs"); }}>Continue to diet & access</button>
                </div>
              )}

              {(step === "needs" || step === "pay" || step === "done") && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Diet, access and arrival</h2>
                  <p className="m">The kitchen is vegetarian: no eggs, and no onion or garlic. Tick an allergen only when it applies, and say how serious it is for that person.</p>
                  {party.slice(0, Math.max(1, Number(form.people) || 1)).map((person, i) => (
                    <div className="diet-p" key={i}>
                      <b>Person {i + 1}</b>
                      <label>First name</label>
                      <input value={person.given_name} onChange={e => setParty(rows => rows.map((p, j) => j === i ? { ...p, given_name: e.target.value } : p))} />
                      <label>Last name</label>
                      <input value={person.family_name} onChange={e => setParty(rows => rows.map((p, j) => j === i ? { ...p, family_name: e.target.value } : p))} />
                      <div className="lbl">Diet</div>
                      <div className="chips">{DIETS.map(([code, label]) => (
                        <button type="button" key={code} className={"chip" + (person.diet.includes(code) ? " on" : "")} onClick={() => setParty(rows => rows.map((p, j) => j === i ? { ...p, diet: p.diet.includes(code) ? p.diet.filter(x => x !== code) : [...p.diet, code] } : p))}>{label}</button>
                      ))}</div>
                      <div className="lbl">UK allergens</div>
                      <div className="checks">{ALLERGENS.map(([code, label]) => {
                        const tick = person.allergens.find(a => a.code === code);
                        return (
                          <label className="check" key={code}>
                            <input type="checkbox" checked={!!tick} onChange={e => setParty(rows => rows.map((p, j) => {
                              if (j !== i) return p;
                              const allergens = e.target.checked ? [...p.allergens, { code, severity: "" }] : p.allergens.filter(a => a.code !== code);
                              return { ...p, allergens };
                            }))} />
                            <span>{label}</span>
                            {tick && <select aria-label={`${label} severity`} value={tick.severity} onChange={e => setParty(rows => rows.map((p, j) => j === i ? { ...p, allergens: p.allergens.map(a => a.code === code ? { ...a, severity: e.target.value } : a) } : p))}>
                              <option value="">How serious?</option>
                              {SEVERITIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                            </select>}
                          </label>
                        );
                      })}</div>
                      <label>Other diet note</label>
                      <input value={person.other} onChange={e => setParty(rows => rows.map((p, j) => j === i ? { ...p, other: e.target.value } : p))} placeholder="Anything else the kitchen should know" />
                      <label>Plate</label>
                      <select value={person.plate} onChange={e => setParty(rows => rows.map((p, j) => j === i ? { ...p, plate: e.target.value } : p))}>
                        <option value="buffet">Buffet — I can serve myself</option>
                        <option value="prepared">Please prepare a plate</option>
                        <option value="table_service">I need table service</option>
                      </select>
                      <label>Help at the table</label>
                      <input value={person.accessibility} onChange={e => setParty(rows => rows.map((p, j) => j === i ? { ...p, accessibility: e.target.value } : p))} placeholder="e.g. needs a seat near the buffet" />
                    </div>
                  ))}
                  <h2 style={{ fontSize: 22, marginTop: 18 }}>Accessibility and arrival</h2>
                  <label>Accessibility for the stay</label>
                  <textarea rows={2} value={form.accessibility_notes} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, accessibility_notes: v })); }} placeholder="Ground floor, step-free, hearing loop…" />
                  <label>Expected arrival time</label>
                  <input value={form.arrival_time_note} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, arrival_time_note: v })); }} placeholder="e.g. 16:30 from Lincoln station" />
                  <label>Room preference</label>
                  <input value={form.room_preference} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, room_preference: v })); }} />
                  <label>Travel / pickup</label>
                  <textarea rows={2} value={form.travel_notes} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, travel_notes: v })); }} placeholder="Train, taxi, self-drive…" />
                  <label>Guest notes</label>
                  <textarea rows={2} value={form.notes} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, notes: v })); }} />
                  <label className="check">
                    <input type="checkbox" checked={form.keep_allergens} onChange={e => setForm(f => ({ ...f, keep_allergens: e.target.checked }))} />
                    <span>Keep my dietary and allergen details for future stays</span>
                  </label>
                  <button className="btn sec" onClick={() => setStep("pay")}>Continue to deposit</button>
                </div>
              )}

              {(step === "pay" || step === "done") && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>Payment & deposit</h2>
                  {paymentsOn
                    ? <p className="m">To secure your place, a deposit is required. You will be taken to a secure Stripe payment page. Your card details are never stored by us — all payments are handled securely by Stripe. Food is not billed.</p>
                    : <p className="m">The house confirms the deposit. Card payments are not taken on this page. Food is not billed — the restaurant is buffet only.</p>}
                  <div style={{ background: "var(--surface, #f5f0e8)", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="m">Deposit amount</span>
                      <b>£{booking.deposit_gbp.toFixed(2)}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span className="m">Balance</span>
                      <span className="m" style={{ color: "var(--ink-2, #666)" }}>{booking.deposit_policy}</span>
                    </div>
                  </div>
                  {paymentsOn ? (
                  <button className="btn" disabled={busy || !form.name || !form.email.includes("@")} onClick={async () => {
                    const enquiryResult = savedEnquiryId ? { id: savedEnquiryId } : await doEnquiry({ finish: false });
                    if (!enquiryResult?.id) return;
                    setSavedEnquiryId(enquiryResult.id);
                    try {
                      const r = await api<{ url: string }>(`/v1/guest-enquiries/${enquiryResult.id}/stripe/checkout`, { method: "POST" });
                      if (r?.url) window.location.href = r.url;
                    } catch (e) {
                      setErr((e as Error).message || "Your place is saved. The card page did not open. Try again from this page — it will not be sent twice.");
                    }
                  }}>
                    {busy ? "…" : "Pay deposit & save my place"}
                  </button>
                  ) : null}
                  <button className="btn sec" style={{ marginTop: 10 }} disabled={busy || !form.name || !form.email.includes("@")} onClick={doEnquiry}>
                    Save place — pay deposit later
                  </button>
                  {ok && <div className="note">{ok}</div>}
                  {err && <div className="note">{err}</div>}
                  {paymentsOn && <p className="m" style={{ fontSize: 12, color: "var(--ink-3, #999)", marginTop: 14 }}>
                    Payments are taken by Stripe. This house does not store the card number or security code.
                  </p>}
                </div>
              )}
              </>}

              {me && mine && mine.length > 0 && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: 22 }}>My Stay</h2>
                  <p className="m">Guest Portal — only you can see this.</p>
                  {checkIn?.href && <p><a className="btn" href={checkIn.href}>{checkIn.check_in ? "Check in" : "Open My Stay"}</a></p>}
                  {mine.map(x => (
                    <div className="row" key={x.id} style={{ display: "block" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span>{x.programme_name ?? "Your dates"} · {fmt(x.arrival)} → {fmt(x.departure)} · {x.people} {Number(x.people) === 1 ? "person" : "people"}</span>
                        <span className="m">{x.status === "CONVERTED" ? "in the house book" : x.status.toLowerCase()}</span>
                      </div>
                      {x.deposit_status === "paid" && <p className="m" style={{ margin: "8px 0 0" }}>Deposit paid{x.deposit_amount != null ? ` · £${Number(x.deposit_amount).toFixed(2)}` : ""}. Food is not billed.</p>}
                      {x.deposit_status === "failed" && <p className="m" style={{ margin: "8px 0 0" }}>The deposit payment did not go through. The house can help.</p>}
                      {x.deposit_status === "refunded" && <p className="m" style={{ margin: "8px 0 0" }}>The deposit was refunded. Food is not billed.</p>}
                      {x.rooms?.length
                        ? <div className="rooms">{x.rooms.map(r => <span key={r.number} className="room">{r.number}{r.section ? ` · ${r.section}` : ""}</span>)}</div>
                        : <p className="m" style={{ margin: "8px 0 0" }}>Rooms appear when the house assigns them.</p>}
                      {(x.status === "ENQUIRY" || x.status === "CONVERTED") && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn sec" onClick={async () => {
                          setBusy(true); setErr(null);
                          try {
                            const detail = await api<{ people: number; arrival: string; departure: string; notes: string | null; accessibility_notes: string | null; room_preference: string | null; arrival_time_note: string | null; travel_notes: string | null; party: PartyPerson[] }>(`/guest/enquiries/${x.id}`);
                            setForm(f => ({ ...f, people: String(detail.people), arrival: detail.arrival, departure: detail.departure, notes: detail.notes ?? "", accessibility_notes: detail.accessibility_notes ?? "", room_preference: detail.room_preference ?? "", arrival_time_note: detail.arrival_time_note ?? "", travel_notes: detail.travel_notes ?? "" }));
                            setParty((detail.party ?? []).map(p => ({ ...blankPerson(), ...p, diet: p.diet ?? [], allergens: p.allergens ?? [], other: p.other ?? "", accessibility: p.accessibility ?? "", plate: p.plate || "buffet" })));
                            setEditingId(x.id); setSel(null); setStep("needs");
                          } catch (e) { setErr((e as Error).message); }
                          finally { setBusy(false); }
                        }}>Update diet & access</button>
                        <button className="btn sec" onClick={async () => {
                          if (!confirm("Cancel this place? The kitchen and desk will be told to stand down.")) return;
                          setBusy(true); setErr(null);
                          try { await api(`/guest/enquiries/${x.id}/cancel`, { method: "POST", body: "{}" }); await loadSigned(); setOk("Cancelled. The house has been told."); }
                          catch (e) { setErr((e as Error).message); }
                          finally { setBusy(false); }
                        }}>Cancel</button>
                      </div>}
                    </div>
                  ))}
                </div>
              )}

              {me && <HearFromUs />}
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
              <div><b>Deposit & refunds</b><span>The house agrees the deposit and any refund when your place is accepted. Nothing is charged on this page.</span></div>
              <div><b>Cancellation</b><span>Terms are confirmed with your booking, not guessed here.</span></div>
              <div><b>Meals & diet</b><span>Kitchen is vegetarian. Tell us vegan, Jain, gluten-free or allergies on the form.</span></div>
              <div><b>Accessibility</b><span>Ask for a ground-floor or accessible room when you save your place.</span></div>
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
