"use client";
/** Public lost-property choice. No sign-in. The link in the message is the only key. */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

type Info = {
  state: "open" | "chosen";
  property_name: string;
  reference: string;
  description: string;
  postage_note: string;
  choice?: string | null;
  detail?: string | null;
};

export default function LostReturn() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<"collection" | "postage" | "">("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [address, setAddress] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) { setErr("This link is missing its code. Open the message again and use the link as it was sent."); return; }
    fetch(`${API}/public/lost-property/${encodeURIComponent(t)}`).then(async r => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.detail ?? "This link is not valid");
      setInfo(b);
    }).catch(e => setErr(e.message));
  }, []);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/public/lost-property/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(choice === "collection" ? { choice, date, time } : { choice, address }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.detail ?? "Could not save your choice");
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "28px 20px 64px" }}>
      <div className="k" style={{ letterSpacing: ".14em", textTransform: "uppercase", color: "var(--gold)", fontSize: 12 }}>{info?.property_name ?? "The house"}</div>
      <h1 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 36, margin: "8px 0" }}>Lost property</h1>
      {err && <div className="note" role="alert">{err}</div>}
      {info && <p>{info.reference}. {info.description}</p>}
      {info?.state === "chosen" && <p>We already have your choice{info.detail ? `: ${info.detail}` : ""}. The house will follow it up.</p>}
      {done && <p>Thank you. The house has been told. No payment has been taken.</p>}
      {info?.state === "open" && !done && (
        <>
          <p>Choose collection or postage. No payment is taken. {info.postage_note}.</p>
          <fieldset style={{ border: 0, padding: 0, margin: "16px 0" }}>
            <legend style={{ fontFamily: "var(--serif)", fontSize: 22 }}>How should we return it?</legend>
            <label style={{ display: "block", marginTop: 8 }}><input type="radio" name="choice" checked={choice === "collection"} onChange={() => setChoice("collection")} /> Collection</label>
            <label style={{ display: "block", marginTop: 8 }}><input type="radio" name="choice" checked={choice === "postage"} onChange={() => setChoice("postage")} /> Postage</label>
          </fieldset>
          {choice === "collection" && (
            <>
              <label style={{ display: "block" }}>Date<input type="date" aria-label="Collection date" value={date} onChange={e => setDate(e.target.value)} /></label>
              <label style={{ display: "block", marginTop: 8 }}>Time<input type="time" aria-label="Collection time" value={time} onChange={e => setTime(e.target.value)} /></label>
            </>
          )}
          {choice === "postage" && (
            <label style={{ display: "block" }}>Address
              <textarea aria-label="Postage address" rows={4} value={address} onChange={e => setAddress(e.target.value)} />
            </label>
          )}
          <button className="btn primary" type="button" disabled={!choice || busy} onClick={submit} style={{ marginTop: 16 }}>{busy ? "Sending…" : "Tell the house"}</button>
        </>
      )}
    </main>
  );
}
