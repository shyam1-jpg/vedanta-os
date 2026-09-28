"use client";
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export default function OptOutForm() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(link);
    if (!link) { setErr("This link is missing its code"); return; }
    fetch(`${API}/public/journey-opt-out/${encodeURIComponent(link)}`)
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.detail ?? "This link is not valid");
        setName(body.given_name);
      })
      .catch(e => setErr((e as Error).message));
  }, []);

  return (
    <div className="pub">
      <div className="pubcard">
        <h1>Retreat notes</h1>
        {err && <div className="note" role="alert">{err}</div>}
        {done ? <p>{done}</p> : token && (
          <>
            <p>{name ? `${name}, this` : "This"} stops notes about future retreats. A message about a stay you already have will still arrive.</p>
            <button className="btn primary" type="button" onClick={async () => {
              const res = await fetch(`${API}/public/journey-opt-out/${encodeURIComponent(token)}`, { method: "POST" });
              const body = await res.json().catch(() => null);
              if (!res.ok) { setErr(body?.detail ?? "That could not be saved"); return; }
              setDone(body.note);
            }}>Stop retreat notes</button>
          </>
        )}
      </div>
    </div>
  );
}
