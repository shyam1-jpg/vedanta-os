"use client";
/** Public stay note. No sign-in. The link in the message is the only key. */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

type Info = {
  state: "open" | "used";
  property_name: string;
  greeting?: string;
  scores?: string[];
  categories?: { code: string; label: string }[];
};

const FACES = ["1", "2", "3", "4", "5"];

export default function FeedbackForm() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [food, setFood] = useState(0);
  const [room, setRoom] = useState(0);
  const [overall, setOverall] = useState(0);
  const [comment, setComment] = useState("");
  const [problem, setProblem] = useState(false);
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) { setErr("This link is missing its code. Open the message again and use the link as it was sent."); return; }
    fetch(`${API}/public/feedback/${encodeURIComponent(t)}`).then(async r => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.detail ?? "This link is not valid");
      setInfo(b);
    }).catch(e => setErr(e.message));
  }, []);

  const scoreRow = (label: string, value: number, set: (n: number) => void) => (
    <fieldset style={{ border: 0, margin: "18px 0", padding: 0 }}>
      <legend style={{ fontFamily: "var(--serif)", fontSize: 22 }}>{label}</legend>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 8 }}>
        {FACES.map((face, i) => {
          const n = i + 1;
          const on = value === n;
          return (
            <button key={face} type="button" role="radio" aria-checked={on} aria-label={`${n} of 5, ${info?.scores?.[i] ?? n}`} onClick={() => set(n)} style={{
              flex: 1, minHeight: 52, borderRadius: 8, border: on ? "2px solid var(--forest)" : "1px solid var(--line)",
              background: on ? "var(--forest)" : "#fff", color: on ? "#F7F1E6" : "var(--ink)", fontSize: 18, fontWeight: 600,
            }}>{n}</button>
          );
        })}
      </div>
    </fieldset>
  );

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/public/feedback/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ food, room, overall, comment, problem, category, detail }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.detail ?? "Could not save");
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "28px 20px 64px" }}>
      <div className="k" style={{ letterSpacing: ".14em", textTransform: "uppercase", color: "var(--gold)", fontSize: 12 }}>{info?.property_name ?? "The house"}</div>
      <h1 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 36, margin: "8px 0" }}>How was your stay?</h1>
      {err && <div className="note" role="alert">{err}</div>}
      {info?.state === "used" && <p>Thank you. This note has already been received.</p>}
      {done && <p>Thank you. That is all we needed.</p>}
      {info?.state === "open" && !done && (
        <>
          <p style={{ color: "var(--ink-2)" }}>{info.greeting && info.greeting !== "Guest" ? `${info.greeting}, three taps are enough.` : "Three taps are enough."} A comment is optional.</p>
          {scoreRow("Food", food, setFood)}
          {scoreRow("Room", room, setRoom)}
          {scoreRow("Overall", overall, setOverall)}
          <label>Anything you would like us to know
            <textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10, font: "inherit" }} />
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
            <input type="checkbox" checked={problem} onChange={e => setProblem(e.target.checked)} />
            Something went wrong
          </label>
          {problem && (
            <div>
              <fieldset style={{ border: 0, padding: 0, marginTop: 8 }}>
                <legend>What was it?</legend>
                {(info.categories ?? []).map(c => (
                  <label key={c.code} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <input type="radio" name="category" checked={category === c.code} onChange={() => setCategory(c.code)} /> {c.label}
                  </label>
                ))}
              </fieldset>
              <label>What happened
                <textarea rows={3} value={detail} onChange={e => setDetail(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10, font: "inherit" }} />
              </label>
            </div>
          )}
          <button className="btn primary" type="button" disabled={busy || !food || !room || !overall} onClick={submit} style={{ marginTop: 18, minHeight: 48, width: "100%" }}>{busy ? "Sending…" : "Send"}</button>
        </>
      )}
    </main>
  );
}
