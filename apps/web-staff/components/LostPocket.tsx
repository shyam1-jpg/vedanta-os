"use client";
import { useEffect, useRef, useState } from "react";
import { API, api, shrinkPhoto, tok } from "@/lib/client";

type Item = {
  id: string; reference: string; description: string; place: string; found_on: string; status: string;
  held_long: boolean; disposal_due: boolean; has_photo: boolean; guest_name: string; booking_ref: string;
  guest_choice_detail: string | null; report_id: string | null; claimant_name: string | null;
};
type Suggestion = { id: string; reference: string; description: string; place: string; reasons: string[] };
type Report = { id: string; description: string | null; status: string; suggestions: Suggestion[]; guest_choice_detail: string | null };
type Disposal = { id: string; reference: string; description: string; found_on: string };
type Board = {
  items: Item[]; reports: Report[]; rooms: string[]; areas: string[]; disposal: Disposal[];
  categories: { code: string; label: string }[]; disposal_days: number; hold_days: number;
};
type Slip = {
  reference: string; description: string; foundPlace: string; foundOn: string; guestName: string; bookingRef: string;
  method: string; handler: string; photo: string | null; status: string;
};
type Preview = { subject: string; body: string; can_send: boolean; warning: string; to_email: string };

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
    ctx.lineWidth = 2.5;
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
    const move = (e: PointerEvent) => { if (!drawing) return; const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const up = () => { if (!drawing) return; drawing = false; onChangeRef.current(canvas.toDataURL("image/png"), ink); };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
  }, []);
  return <canvas ref={ref} width={360} height={140} aria-label="Guest signature" style={{ width: "100%", height: 140, background: "#fff", touchAction: "none", border: "1px solid var(--line)" }} />;
}

export default function LostPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [place, setPlace] = useState("");
  const [foundOn, setFoundOn] = useState("");
  const [storage, setStorage] = useState("");
  const [photo, setPhoto] = useState("");
  const [missing, setMissing] = useState("");
  const [booking, setBooking] = useState("");
  const [slip, setSlip] = useState<Slip | null>(null);
  const [slipId, setSlipId] = useState<string | null>(null);
  const [collector, setCollector] = useState("");
  const [ink, setInk] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () => api<Board>("/v1/lost-found").then(setBoard);
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []);
  if (!board) return <p className="m">Opening lost and found…</p>;
  const places = [...board.rooms.map(n => `Room ${n}`), ...board.areas];
  const open = board.items.filter(i => !["returned", "disposed", "donated"].includes(i.status));
  const fail = (e: unknown) => onError((e as Error).message);
  const openPdf = async (size: "a4" | "a5") => {
    if (!slipId) return;
    const headers: Record<string, string> = {};
    const t = tok.get();
    if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/lost-found/${slipId}/slip?format=pdf&size=${size}`, { headers });
    if (!res.ok) { onError("Could not open the return slip"); return; }
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  };
  return (
    <div>
      {note && <div className="note">{note}</div>}
      <div className="card">
        <h2>Eligible for disposal</h2>
        <p className="m">After {board.disposal_days} days. Nothing is thrown away from this list until you choose.</p>
        {board.disposal.length === 0 && <p className="m">Nothing is eligible for disposal.</p>}
        {board.disposal.map(row => (
          <div key={row.id} style={{ marginTop: 10 }}>
            <b>{row.reference}</b>
            <p className="m">{row.description} · found {row.found_on}</p>
            <input aria-label={`Reason for ${row.reference}`} placeholder="Reason" id={`reason-${row.id}`} />
            <input aria-label={`Recipient for ${row.reference}`} placeholder="Donated to" id={`who-${row.id}`} />
            <input type="date" aria-label={`Keep ${row.reference} until`} id={`until-${row.id}`} />
            <div className="tabs">
              <button type="button" onClick={async () => {
                const reason = (document.getElementById(`reason-${row.id}`) as HTMLInputElement).value;
                try { await api(`/v1/lost-found/${row.id}/status`, { method: "POST", body: JSON.stringify({ status: "disposed", note: reason }) }); setNote("Disposed"); onError(null); await load(); }
                catch (e) { fail(e); }
              }}>Dispose</button>
              <button type="button" onClick={async () => {
                const reason = (document.getElementById(`reason-${row.id}`) as HTMLInputElement).value;
                const recipient = (document.getElementById(`who-${row.id}`) as HTMLInputElement).value;
                try { await api(`/v1/lost-found/${row.id}/status`, { method: "POST", body: JSON.stringify({ status: "donated", note: reason, recipient }) }); setNote("Donated"); onError(null); await load(); }
                catch (e) { fail(e); }
              }}>Donate</button>
              <button type="button" onClick={async () => {
                const reason = (document.getElementById(`reason-${row.id}`) as HTMLInputElement).value;
                const until = (document.getElementById(`until-${row.id}`) as HTMLInputElement).value;
                try { await api(`/v1/lost-found/${row.id}/keep`, { method: "POST", body: JSON.stringify({ until, reason }) }); setNote("Kept longer"); onError(null); await load(); }
                catch (e) { fail(e); }
              }}>Keep longer</button>
            </div>
          </div>
        ))}
      </div>
      {board.items.some(i => i.held_long) && <div className="note"><b>Held too long.</b> {board.items.filter(i => i.held_long).map(i => i.description).join(" · ")}</div>}
      <div className="card">
        <h2>Found</h2>
        <input aria-label="What was found" placeholder="What was found" value={description} onChange={e => setDescription(e.target.value)} />
        <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>{(board.categories ?? [{ code: "other", label: "Other" }]).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
        <select aria-label="Where found" value={place} onChange={e => setPlace(e.target.value)}><option value="">Where</option>{places.map(p => <option key={p}>{p}</option>)}</select>
        <input type="date" aria-label="Date found" value={foundOn} onChange={e => setFoundOn(e.target.value)} />
        <input aria-label="Storage" placeholder="Where it is kept" value={storage} onChange={e => setStorage(e.target.value)} />
        <input type="file" accept="image/*" aria-label="Photo" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setPhoto(await shrinkPhoto(file)); } catch (err) { onError((err as Error).message); } }} />
        <button className="btn" type="button" onClick={async () => {
          try {
            await api("/v1/lost-found", { method: "POST", body: JSON.stringify({ description, category, place, found_on: foundOn, storage, photo }) });
            setDescription(""); setStorage(""); setPhoto("");
            onError(null); setNote("Logged");
            await load();
          } catch (e) { fail(e); }
        }}>Log it</button>
      </div>
      {open.map(item => (
        <div className="card" key={item.id}>
          <h2>{item.reference}</h2>
          <p>{item.description}</p>
          <p className="m">{item.place} · {item.found_on} · {item.status}{item.held_long ? " · held too long" : ""}{item.disposal_due ? " · eligible for disposal" : ""}{item.has_photo ? " · photo" : ""}</p>
          {(item.guest_name || item.guest_choice_detail) && <p className="m">{item.guest_name}{item.booking_ref ? ` · ${item.booking_ref}` : ""}{item.guest_choice_detail ? ` · ${item.guest_choice_detail}` : ""}</p>}
          <div className="tabs">
            <button type="button" onClick={async () => {
              try {
                const next = await api<Slip>(`/v1/lost-found/${item.id}/slip`);
                setSlip(next); setSlipId(item.id); setCollector(next.guestName || ""); setInk(null); onError(null);
              } catch (e) { fail(e); }
            }}>Return slip</button>
            {item.report_id && ["matched", "claimed"].includes(item.status) && <button type="button" onClick={async () => {
              try { setPreview(await api<Preview>(`/v1/lost-found/${item.id}/notify`)); setPreviewId(item.id); onError(null); }
              catch (e) { fail(e); }
            }}>Notify guest</button>}
          </div>
        </div>
      ))}
      {slip && (
        <div className="card" id="return-slip">
          <h2>Return slip · {slip.reference}</h2>
          {slip.photo && <img src={slip.photo} alt="" style={{ width: 120, height: 90, objectFit: "cover" }} />}
          <p>{slip.description}</p>
          <p className="m">Found at {slip.foundPlace} on {slip.foundOn}</p>
          <p className="m">Guest {slip.guestName || "Not named"} · Booking {slip.bookingRef || "Not linked"}</p>
          <p className="m">Return {slip.method || "Not chosen yet"} · Handled by {slip.handler}</p>
          <p className="m">Guest signature ______________________________</p>
          <div className="tabs">
            <button type="button" onClick={() => openPdf("a5")}>A5</button>
            <button type="button" onClick={() => openPdf("a4")}>A4</button>
          </div>
          {["matched", "claimed"].includes(slip.status) && (
            <>
              <input aria-label="Collected by" placeholder="Who is collecting it" value={collector} onChange={e => setCollector(e.target.value)} />
              <SignaturePad onChange={(data, drawn) => setInk(drawn ? data : null)} />
              <button className="btn" type="button" onClick={async () => {
                try {
                  await api(`/v1/lost-found/${slipId}/collect`, { method: "POST", body: JSON.stringify({ claimant_name: collector, signature: ink }) });
                  setSlip(null); setNote("Marked collected"); onError(null); await load();
                } catch (e) { fail(e); }
              }}>Mark collected</button>
            </>
          )}
        </div>
      )}
      {preview && (
        <div className="card">
          <h2>Notify guest</h2>
          <p className="m">Nothing is sent until you press send. {preview.to_email}</p>
          {preview.warning && <p className="m">{preview.warning}</p>}
          <p><b>{preview.subject}</b></p>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{preview.body}</pre>
          <button className="btn" type="button" disabled={!preview.can_send} onClick={async () => {
            try {
              await api(`/v1/lost-found/${previewId}/notify`, { method: "POST", body: JSON.stringify({ send: true }) });
              setPreview(null); setNote("Guest notified"); onError(null); await load();
            } catch (e) { fail(e); }
          }}>Send</button>
        </div>
      )}
      <div className="card">
        <h2>Guest is missing something</h2>
        <textarea rows={2} aria-label="What is missing" value={missing} onChange={e => setMissing(e.target.value)} />
        <input aria-label="Booking reference" placeholder="Booking reference" value={booking} onChange={e => setBooking(e.target.value)} />
        <button className="btn" type="button" onClick={async () => {
          try {
            await api("/v1/lost-found/reports", { method: "POST", body: JSON.stringify({ description: missing, category: "other", booking_ref: booking }) });
            setMissing(""); setBooking(""); setNote("Report saved"); onError(null); await load();
          } catch (e) { fail(e); }
        }}>Save report</button>
        {board.reports.filter(r => r.status === "open").map(r => (
          <div key={r.id}>
            <p><b>{r.description}</b></p>
            {r.suggestions.length === 0 && <p className="m">No likely matches in the found log.</p>}
            {r.suggestions.map(match => (
              <div key={match.id}>
                <p className="m">{match.reference} · {match.description} ({match.place})</p>
                <p className="m">{match.reasons.join(" · ")}</p>
                <div className="tabs">
                  <button type="button" onClick={async () => {
                    try { await api(`/v1/lost-found/reports/${r.id}/decision`, { method: "POST", body: JSON.stringify({ item_id: match.id, action: "confirm" }) }); setNote("Match confirmed"); onError(null); await load(); }
                    catch (e) { fail(e); }
                  }}>Confirm match</button>
                  <button type="button" onClick={async () => {
                    try { await api(`/v1/lost-found/reports/${r.id}/decision`, { method: "POST", body: JSON.stringify({ item_id: match.id, action: "reject" }) }); setNote("Not a match"); onError(null); await load(); }
                    catch (e) { fail(e); }
                  }}>Not a match</button>
                </div>
              </div>
            ))}
            {r.guest_choice_detail && <p className="m">{r.guest_choice_detail}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
