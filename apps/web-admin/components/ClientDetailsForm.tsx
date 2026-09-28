"use client";
/** No-login form for a guest to record their own dietary and access needs. */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import AllergenFields from "@/components/AllergenFields";

export default function ClientDetailsForm() {
  const [token, setToken] = useState("");
  const [given, setGiven] = useState("");
  const [group, setGroup] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [severity, setSeverity] = useState("");
  const [notes, setNotes] = useState("");
  const [access, setAccess] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(link);
    if (!link) { setErr("This link is missing its code"); return; }
    fetch(`${API}/public/client-details/${encodeURIComponent(link)}`)
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.detail ?? "This link is not valid");
        setGiven(body.given_name);
        setGroup(body.group_name);
        setChoices(body.allergens ?? []);
        setAccess(!!body.needs_access);
        if (body.complete) setDone(true);
      })
      .catch(e => setErr((e as Error).message));
  }, []);

  const send = async (nothing: boolean) => {
    if (!nothing && picked.length && !severity) { setErr("Say how serious the allergy is"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/public/client-details/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nothing ? { allergens: [], needs_access: access } : { allergens: picked, severity, diet_notes: notes, needs_access: access }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "That could not be saved");
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="pub">
      <div className="pubcard">
        <div className="pubbrand">The Vedanta Way<br /><span>Retreat Center</span></div>
        <h1>Your stay details</h1>
        {given && <p>{given}, this is only for {group}. The organiser sees that you have finished, not the answers.</p>}
        {err && <div className="note">{err}</div>}
        {done ? <p>Thank you. Your details are in.</p> : token && (
          <>
            <AllergenFields choices={choices} picked={picked} setPicked={setPicked} severity={severity} setSeverity={setSeverity} notes={notes} setNotes={setNotes} access={access} setAccess={setAccess} />
            <div className="actions">
              <button className="btn primary" type="button" disabled={busy} onClick={() => send(false)}>Save my details</button>
              <button className="btn" type="button" disabled={busy} onClick={() => send(true)}>Nothing to declare</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
