"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Prefs = {
  enabled: boolean;
  operational_channel: "email" | "sms" | "none";
  marketing: boolean;
  marketing_channel: "email" | "sms" | "none";
  quiet_from: string;
  quiet_to: string;
  wording: string;
};

export default function HearFromUs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const token = sessionStorage.getItem("vedanta.guest.token");
    if (!token) return;
    const res = await fetch(`${API}/guest/comms-prefs`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const body = await res.json();
    if (body.enabled) setPrefs({ operational_channel: "email", marketing: false, marketing_channel: "none", quiet_from: "22:00", quiet_to: "07:00", ...body });
  };

  useEffect(() => { load().catch(() => {}); }, []);
  if (!prefs) return null;

  const save = async () => {
    setErr(null);
    const token = sessionStorage.getItem("vedanta.guest.token");
    const res = await fetch(`${API}/guest/comms-prefs`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(prefs),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) { setErr(body?.detail ?? "That could not be saved"); return; }
    setPrefs(body);
    setNote("Saved.");
  };

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="my-stay-hear">
      <h2 style={{ fontSize: 20 }}>How you hear from us</h2>
      <p className="m">The same page is linked from the foot of our emails. Retreat notes start unticked.</p>
      <label>Messages about a stay
        <select aria-label="Stay messages" value={prefs.operational_channel} onChange={e => setPrefs({ ...prefs, operational_channel: e.target.value as Prefs["operational_channel"] })}>
          <option value="email">Email</option>
          <option value="sms">Text</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!prefs.marketing} onChange={e => setPrefs({ ...prefs, marketing: e.target.checked, marketing_channel: e.target.checked ? (prefs.marketing_channel === "none" ? "email" : prefs.marketing_channel) : "none" })} />
        {prefs.wording}
      </label>
      <label>Quiet from<input aria-label="Quiet from" value={prefs.quiet_from} onChange={e => setPrefs({ ...prefs, quiet_from: e.target.value })} /></label>
      <label>Quiet until<input aria-label="Quiet until" value={prefs.quiet_to} onChange={e => setPrefs({ ...prefs, quiet_to: e.target.value })} /></label>
      <button className="btn" type="button" onClick={save}>Save</button>
      {note && <p className="m">{note}</p>}
      {err && <div className="note">{err}</div>}
    </div>
  );
}
