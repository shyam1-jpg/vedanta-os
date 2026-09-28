"use client";
import { useEffect, useRef, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

type Event = { from_status: string | null; to_status: string | null; note: string | null; by_name: string | null; created_at: string };
type Item = {
  id: string; reference: string; description: string; category: string; place: string; found_on: string; found_by_name: string | null;
  storage: string | null; status: string; claimant_name: string | null; return_method: string | null;
  handled_by_name: string | null; held_long: boolean; disposal_due: boolean; has_photo: boolean; has_signature: boolean;
  events: Event[]; report_id: string | null; guest_name: string; booking_ref: string;
  guest_choice: string | null; guest_choice_detail: string | null; donate_to: string | null; disposal_reason: string | null;
  notified_on: string | null; hold_until: string | null;
};
type Suggestion = { id: string; reference: string; description: string; place: string; found_on: string; score: number; reasons: string[] };
type Report = {
  id: string; description: string | null; category: string; place: string | null; happened_on: string | null;
  contact_name: string | null; contact_email: string | null; status: string; guest_name: string; booking_code: string;
  guest_choice: string | null; guest_choice_detail: string | null; suggestions: Suggestion[];
};
type Disposal = { id: string; reference: string; description: string; found_on: string; status: string };
type Board = {
  items: Item[]; reports: Report[]; rooms: string[]; areas: string[]; categories: { code: string; label: string }[];
  hold_days: number; disposal_days: number; postage_note: string; disposal: Disposal[];
};
type Slip = {
  reference: string; description: string; foundPlace: string; foundOn: string; guestName: string; bookingRef: string;
  method: string; handler: string; photo: string | null; signature: string | null; status: string; postage_note: string;
};
type Preview = { subject: string; body: string; sms: string; to_email: string; to_phone: string; sms_ready: boolean; can_send: boolean; warning: string };
type Draft = { id: string; kind: "dispose" | "donate" | "keep"; reason: string; recipient: string; until: string };

const STATUS: Record<string, string> = { logged: "Logged", matched: "Matched", claimed: "Claimed", returned: "Returned", disposed: "Disposed", donated: "Donated" };

function SignaturePad({ onChange }: { onChange: (data: string, ink: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    let drawing = false;
    let ink = false;
    const point = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: (e.clientX - box.left) * (canvas.width / box.width), y: (e.clientY - box.top) * (canvas.height / box.height) };
    };
    const down = (e: PointerEvent) => {
      drawing = true; ink = true;
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const p = point(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const up = () => {
      if (!drawing) return;
      drawing = false;
      onChangeRef.current(canvas.toDataURL("image/png"), ink);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);
  return <canvas ref={ref} width={480} height={140} aria-label="Guest signature" style={{ width: "100%", maxWidth: 480, height: 140, border: "1px solid var(--line)", background: "#fff", touchAction: "none" }} />;
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("Attach a photo as an image")); el.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the photo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
    if (data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export default function LostFound() {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState({ q: "", category: "", status: "", place: "" });
  const [found, setFound] = useState({ description: "", category: "other", place: "", found_on: "", storage: "", photo: "" });
  const [missing, setMissing] = useState({ description: "", category: "other", place: "", happened_on: "", contact_name: "", contact_email: "", contact_phone: "", booking_ref: "" });
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [slipId, setSlipId] = useState<string | null>(null);
  const [collector, setCollector] = useState("");
  const [ink, setInk] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const load = () => {
    const qs = new URLSearchParams();
    if (filter.q) qs.set("q", filter.q);
    if (filter.category) qs.set("category", filter.category);
    if (filter.status) qs.set("status", filter.status);
    if (filter.place) qs.set("place", filter.place);
    api<Board>(`/v1/lost-found?${qs}`).then(setBoard).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open lost and found"));
  };
  useEffect(() => { load(); }, [filter.category, filter.status, filter.place]);
  if (!board) return <div className="empty">Opening lost and found…</div>;
  const places = [...board.rooms.map(n => `Room ${n}`), ...board.areas];
  const fail = (e: unknown) => say(e instanceof ApiError ? e.problem.detail : "Could not update it");
  const move = async (item: Item, status: string, extra: Record<string, string> = {}) => {
    try {
      await api(`/v1/lost-found/${item.id}/status`, { method: "POST", body: JSON.stringify({ status, ...extra }) });
      setDraft(null);
      say("Updated");
      load();
    } catch (e) { fail(e); }
  };
  const openSlip = async (id: string) => {
    try {
      const next = await api<Slip>(`/v1/lost-found/${id}/slip`);
      setSlip(next);
      setSlipId(id);
      setCollector(next.guestName || "");
      setInk(null);
    } catch (e) { fail(e); }
  };
  const openPdf = async (size: "a4" | "a5") => {
    if (!slipId) return;
    try {
      const headers: Record<string, string> = {};
      const t = token.get();
      if (t) headers.authorization = `Bearer ${t}`;
      const res = await fetch(`${API}/v1/lost-found/${slipId}/slip?format=pdf&size=${size}`, { headers });
      if (!res.ok) throw new Error("Could not open the return slip");
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
    } catch (e) { say((e as Error).message); }
  };
  const outcome = (item: Item) => (
    draft?.id === item.id ? (
      <div style={{ display: "grid", gap: 8, maxWidth: 420, marginTop: 8 }}>
        {draft.kind === "donate" && <input aria-label="Donation recipient" placeholder="Who it was donated to" value={draft.recipient} onChange={e => setDraft({ ...draft, recipient: e.target.value })} />}
        {draft.kind === "keep" && <label>Keep until<input type="date" aria-label="Keep until" value={draft.until} onChange={e => setDraft({ ...draft, until: e.target.value })} /></label>}
        <input aria-label={draft.kind === "keep" ? "Reason to keep" : draft.kind === "donate" ? "Donation reason" : "Disposal reason"} placeholder="Reason" value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} />
        <button className="btn" type="button" onClick={() => {
          if (draft.kind === "keep") {
            api(`/v1/lost-found/${item.id}/keep`, { method: "POST", body: JSON.stringify({ until: draft.until, reason: draft.reason }) }).then(() => { setDraft(null); say("Kept longer"); load(); }).catch(fail);
            return;
          }
          move(item, draft.kind === "donate" ? "donated" : "disposed", draft.kind === "donate" ? { recipient: draft.recipient, note: draft.reason } : { note: draft.reason });
        }}>{draft.kind === "keep" ? "Keep longer" : draft.kind === "donate" ? "Confirm donation" : "Confirm disposal"}</button>
      </div>
    ) : null
  );
  return (
    <>
      <div className="topbar"><div><h1>Lost and found</h1><p>What was found, what a guest is missing, and what should not be held past {board.hold_days} days. Unclaimed items become eligible for disposal after {board.disposal_days} days.</p></div></div>
      <div className="panel">
        <h3>Eligible for disposal</h3>
        <p className="m">Counted from the found date, or from the day the guest was told. Choose disposed, donated, or keep longer.</p>
        {board.disposal.length === 0 && <p className="m">Nothing is eligible for disposal.</p>}
        {board.disposal.map(row => {
          const item: Item = board.items.find(i => i.id === row.id) ?? {
            ...row, category: "", place: "", found_by_name: null, storage: null, claimant_name: null, return_method: null,
            handled_by_name: null, held_long: false, disposal_due: true, has_photo: false, has_signature: false, events: [],
            report_id: null, guest_name: "", booking_ref: "", guest_choice: null, guest_choice_detail: null,
            donate_to: null, disposal_reason: null, notified_on: null, hold_until: null,
          };
          return (
            <div className="ops-card" key={row.id}>
              <div className="ops-card-top"><b>{row.reference}</b><span className="m">{row.description}</span></div>
              <div className="m">Found {row.found_on} · {STATUS[row.status] ?? row.status}</div>
              <div className="tabs">
                <button className="btn" type="button" onClick={() => setDraft({ id: row.id, kind: "dispose", reason: "", recipient: "", until: "" })}>Dispose</button>
                <button className="btn" type="button" onClick={() => setDraft({ id: row.id, kind: "donate", reason: "", recipient: "", until: "" })}>Donate</button>
                <button className="btn" type="button" onClick={() => setDraft({ id: row.id, kind: "keep", reason: "", recipient: "", until: "" })}>Keep longer</button>
              </div>
              {outcome(item)}
            </div>
          );
        })}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Log a found item</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Description" placeholder="What was found" value={found.description} onChange={e => setFound({ ...found, description: e.target.value })} />
          <select aria-label="Category" value={found.category} onChange={e => setFound({ ...found, category: e.target.value })}>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Where it was found" value={found.place} onChange={e => setFound({ ...found, place: e.target.value })}>
            <option value="">Where</option>
            {places.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <label>Date found<input type="date" value={found.found_on} onChange={e => setFound({ ...found, found_on: e.target.value })} /></label>
          <input aria-label="Storage" placeholder="Where it is kept" value={found.storage} onChange={e => setFound({ ...found, storage: e.target.value })} />
          <input type="file" accept="image/*" aria-label="Photo" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setFound({ ...found, photo: await shrink(file) }); } catch (err) { say((err as Error).message); } }} />
          <button className="btn primary" type="button" onClick={async () => {
            try {
              await api("/v1/lost-found", { method: "POST", body: JSON.stringify(found) });
              setFound({ description: "", category: "other", place: "", found_on: "", storage: "", photo: "" });
              say("Logged");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not log it"); }
          }}>Log found item</button>
        </div>
        <h3 style={{ marginTop: 18 }}>A guest reports something missing</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Missing item" placeholder="What is missing" value={missing.description} onChange={e => setMissing({ ...missing, description: e.target.value })} />
          <select aria-label="Missing category" value={missing.category} onChange={e => setMissing({ ...missing, category: e.target.value })}>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Where it was missed" value={missing.place} onChange={e => setMissing({ ...missing, place: e.target.value })}>
            <option value="">Where they last had it</option>
            {places.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <label>Around this date<input type="date" value={missing.happened_on} onChange={e => setMissing({ ...missing, happened_on: e.target.value })} /></label>
          <input aria-label="Booking reference" placeholder="Booking reference" value={missing.booking_ref} onChange={e => setMissing({ ...missing, booking_ref: e.target.value })} />
          <input aria-label="Contact name" placeholder="Name" value={missing.contact_name} onChange={e => setMissing({ ...missing, contact_name: e.target.value })} />
          <input aria-label="Contact email" placeholder="Email" value={missing.contact_email} onChange={e => setMissing({ ...missing, contact_email: e.target.value })} />
          <input aria-label="Contact phone" placeholder="Phone" value={missing.contact_phone} onChange={e => setMissing({ ...missing, contact_phone: e.target.value })} />
          <button className="btn" type="button" onClick={async () => {
            try {
              await api("/v1/lost-found/reports", { method: "POST", body: JSON.stringify(missing) });
              setMissing({ description: "", category: "other", place: "", happened_on: "", contact_name: "", contact_email: "", contact_phone: "", booking_ref: "" });
              say("Report saved");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the report"); }
          }}>Save missing report</button>
        </div>
      </div>
      {slip && (
        <div className="panel" style={{ marginTop: 16 }} id="return-slip">
          <h3>Return slip · {slip.reference}</h3>
          <div style={{ display: "grid", gap: 6, maxWidth: 520 }}>
            {slip.photo && <img src={slip.photo} alt="" style={{ width: 120, height: 90, objectFit: "cover" }} />}
            <div>{slip.description}</div>
            <div className="m">Found at {slip.foundPlace} on {slip.foundOn}</div>
            <div className="m">Guest {slip.guestName || "Not named"} · Booking {slip.bookingRef || "Not linked"}</div>
            <div className="m">Return {slip.method || "Not chosen yet"} · Handled by {slip.handler}</div>
            <div className="m">{slip.postage_note}. No payment is taken.</div>
            {slip.signature ? <img src={slip.signature} alt="Saved signature" style={{ width: 240, background: "#fff" }} /> : <div className="m">Guest signature ______________________________</div>}
          </div>
          <div className="tabs">
            <button className="btn" type="button" onClick={() => openPdf("a4")}>Print A4</button>
            <button className="btn" type="button" onClick={() => openPdf("a5")}>Print A5</button>
          </div>
          {["matched", "claimed"].includes(slip.status) && (
            <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
              <input aria-label="Collected by" placeholder="Who is collecting it" value={collector} onChange={e => setCollector(e.target.value)} />
              <SignaturePad onChange={(data, drawn) => setInk(drawn ? data : null)} />
              <button className="btn primary" type="button" onClick={async () => {
                try {
                  await api(`/v1/lost-found/${slipId}/collect`, { method: "POST", body: JSON.stringify({ claimant_name: collector, signature: ink }) });
                  say("Marked collected");
                  setSlip(null);
                  load();
                } catch (e) { fail(e); }
              }}>Mark collected</button>
            </div>
          )}
        </div>
      )}
      {preview && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Notify guest</h3>
          <p className="m">Nothing is sent until you press send. {preview.to_email ? `Email ${preview.to_email}. ` : ""}{preview.to_phone ? "A phone number is saved. " : ""}{preview.sms_ready ? "Text messages are switched on." : "Text messages stay off until they are configured."}</p>
          {preview.warning && <p className="m">{preview.warning}</p>}
          <p><b>{preview.subject}</b></p>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{preview.body}</pre>
          <button className="btn primary" type="button" disabled={!preview.can_send} onClick={async () => {
            try {
              await api(`/v1/lost-found/${previewId}/notify`, { method: "POST", body: JSON.stringify({ send: true }) });
              setPreview(null);
              say("Guest notified");
              load();
            } catch (e) { fail(e); }
          }}>Send</button>
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Found</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Search found items" placeholder="Search" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} onKeyDown={e => { if (e.key === "Enter") load(); }} />
          <select aria-label="Filter category" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}><option value="">All categories</option>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Filter status" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Filter place" value={filter.place} onChange={e => setFilter({ ...filter, place: e.target.value })}><option value="">All places</option>{places.map(p => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        {board.items.map(item => (
          <div className="ops-card" key={item.id}>
            <div className="ops-card-top"><b>{item.reference} · {item.description}</b><span className="m">{STATUS[item.status] ?? item.status}{item.held_long ? " · held too long" : ""}{item.disposal_due ? " · eligible for disposal" : ""}</span></div>
            <div className="m">{item.place} · found {item.found_on} by {item.found_by_name ?? "staff"}{item.storage ? ` · kept in ${item.storage}` : ""}{item.has_photo ? " · photo" : ""}{item.has_signature ? " · signed" : ""}</div>
            {(item.guest_name || item.booking_ref || item.guest_choice_detail) && <div className="m">{item.guest_name}{item.booking_ref ? ` · ${item.booking_ref}` : ""}{item.guest_choice_detail ? ` · ${item.guest_choice_detail}` : ""}</div>}
            {item.claimant_name && <div className="m">Claimed by {item.claimant_name}{item.return_method ? ` · ${item.return_method}` : ""}{item.handled_by_name ? ` · handled by ${item.handled_by_name}` : ""}</div>}
            {item.donate_to && <div className="m">Donated to {item.donate_to}{item.disposal_reason ? ` · ${item.disposal_reason}` : ""}</div>}
            {item.hold_until && <div className="m">Keep until {item.hold_until}</div>}
            <div className="tabs">
              <button className="btn" type="button" onClick={() => openSlip(item.id)}>Return slip</button>
              {item.report_id && ["matched", "claimed"].includes(item.status) && <button className="btn" type="button" onClick={async () => {
                try { setPreview(await api<Preview>(`/v1/lost-found/${item.id}/notify`)); setPreviewId(item.id); }
                catch (e) { fail(e); }
              }}>Notify guest</button>}
              {(item.status === "logged" || item.status === "matched") && <button className="btn" type="button" onClick={() => { const name = window.prompt("Who claimed it?") ?? ""; if (name.trim()) move(item, "claimed", { claimant_name: name.trim() }); }}>Claimed</button>}
              {["matched", "claimed"].includes(item.status) && <button className="btn" type="button" onClick={() => openSlip(item.id)}>Collected</button>}
              {item.status === "claimed" && <button className="btn" type="button" onClick={() => move(item, "returned", { claimant_name: item.claimant_name ?? item.guest_name, return_method: "posted" })}>Posted</button>}
              {["logged", "matched"].includes(item.status) && <button className="btn" type="button" onClick={() => setDraft({ id: item.id, kind: "dispose", reason: "", recipient: "", until: "" })}>Dispose</button>}
              {["logged", "matched"].includes(item.status) && <button className="btn" type="button" onClick={() => setDraft({ id: item.id, kind: "donate", reason: "", recipient: "", until: "" })}>Donate</button>}
              {!["returned", "disposed", "donated"].includes(item.status) && <button className="btn" type="button" onClick={() => setDraft({ id: item.id, kind: "keep", reason: "", recipient: "", until: "" })}>Keep longer</button>}
            </div>
            {outcome(item)}
            {(item.events ?? []).length > 0 && <ul className="m">{item.events.map((ev, i) => <li key={i}>{ev.to_status || "Note"}{ev.by_name ? ` · ${ev.by_name}` : ""}{ev.note ? ` · ${ev.note}` : ""}</li>)}</ul>}
          </div>
        ))}
        {board.items.length === 0 && <p className="m">Nothing in the log for this filter.</p>}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Missing</h3>
        {board.reports.map(report => (
          <div className="ops-card" key={report.id}>
            <div className="ops-card-top"><b>{report.description}</b><span className="m">{report.status}</span></div>
            <div className="m">{report.place || "Place not given"}{report.happened_on ? ` · ${report.happened_on}` : ""}{report.guest_name ? ` · ${report.guest_name}` : ""}{report.booking_code ? ` · ${report.booking_code}` : ""}</div>
            {report.guest_choice_detail && <div className="m">{report.guest_choice_detail}</div>}
            {report.suggestions.map(match => (
              <div key={match.id} style={{ marginTop: 8 }}>
                <div>{match.reference} · {match.description} ({match.place}, {match.found_on})</div>
                <div className="m">{match.reasons.join(" · ")}</div>
                {report.status === "open" && (
                  <div className="tabs">
                    <button className="btn" type="button" onClick={async () => {
                      try {
                        await api(`/v1/lost-found/reports/${report.id}/decision`, { method: "POST", body: JSON.stringify({ item_id: match.id, action: "confirm" }) });
                        say("Match confirmed");
                        load();
                      } catch (e) { fail(e); }
                    }}>Confirm match</button>
                    <button className="btn" type="button" onClick={async () => {
                      try {
                        await api(`/v1/lost-found/reports/${report.id}/decision`, { method: "POST", body: JSON.stringify({ item_id: match.id, action: "reject" }) });
                        say("Not a match");
                        load();
                      } catch (e) { fail(e); }
                    }}>Not a match</button>
                  </div>
                )}
              </div>
            ))}
            {report.status === "open" && report.suggestions.length === 0 && <p className="m">No likely matches in the found log.</p>}
          </div>
        ))}
        {board.reports.length === 0 && <p className="m">No missing reports.</p>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
