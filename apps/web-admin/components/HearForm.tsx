"use client";
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

type Prefs = {
  enabled: boolean;
  purpose?: string;
  operational_channel: "email" | "sms" | "none";
  marketing: boolean;
  marketing_channel: "email" | "sms" | "none";
  quiet_from: string;
  quiet_to: string;
  wording: string;
};

export default function HearForm() {
  const [token, setToken] = useState("");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(link);
    if (!link) { setErr("This link is missing its code"); return; }
    fetch(`${API}/public/comms/${encodeURIComponent(link)}`)
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.detail ?? "This link is not valid");
        setPrefs(body);
        if (body.purpose === "unsubscribe") {
          const stopped = await fetch(`${API}/public/comms/${encodeURIComponent(link)}/unsubscribe`, { method: "POST" });
          const done = await stopped.json().catch(() => null);
          if (!stopped.ok) throw new Error(done?.detail ?? "That could not be saved");
          setNote(done.note);
        }
      })
      .catch(e => setErr((e as Error).message));
  }, []);

  const save = async () => {
    if (!prefs) return;
    setErr(null);
    const res = await fetch(`${API}/public/comms/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) { setErr(body?.detail ?? "That could not be saved"); return; }
    setPrefs(body);
    setNote("Saved. Retreat notes stay off unless that box is ticked.");
  };

  return (
    <div className="pub" data-testid="hear-form">
      <div className="pubcard">
        <h1>How you hear from us</h1>
        {err && <div className="note" role="alert">{err}</div>}
        {note && <p>{note}</p>}
        {prefs && prefs.purpose !== "unsubscribe" && (
          <>
            <p>Choose how The Vedanta contacts you. Messages about a booking you already have can still be sent. Notes about future retreats are optional and start unticked.</p>
            {!prefs.enabled && <p>The house has not switched this page on yet. Your choice will be kept when it is.</p>}
            <label>Messages about a stay
              <select aria-label="Stay messages" value={prefs.operational_channel} onChange={e => setPrefs({ ...prefs, operational_channel: e.target.value as Prefs["operational_channel"] })}>
                <option value="email">Email</option>
                <option value="sms">Text</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="assign-check">
              <input type="checkbox" checked={prefs.marketing} onChange={e => setPrefs({ ...prefs, marketing: e.target.checked, marketing_channel: e.target.checked ? (prefs.marketing_channel === "none" ? "email" : prefs.marketing_channel) : "none" })} />
              {prefs.wording}
            </label>
            {prefs.marketing && (
              <label>Retreat notes
                <select aria-label="Retreat notes" value={prefs.marketing_channel} onChange={e => setPrefs({ ...prefs, marketing_channel: e.target.value as Prefs["marketing_channel"] })}>
                  <option value="email">Email</option>
                  <option value="sms">Text</option>
                </select>
              </label>
            )}
            <label>Quiet hours from<input aria-label="Quiet from" value={prefs.quiet_from} onChange={e => setPrefs({ ...prefs, quiet_from: e.target.value })} /></label>
            <label>Quiet hours until<input aria-label="Quiet until" value={prefs.quiet_to} onChange={e => setPrefs({ ...prefs, quiet_to: e.target.value })} /></label>
            <p className="m">A message that can wait is held during quiet hours. A message that cannot wait, such as an access code, still uses the channel you chose.</p>
            <button className="btn primary" type="button" onClick={save} disabled={!prefs.enabled}>Save</button>
          </>
        )}
      </div>
    </div>
  );
}
