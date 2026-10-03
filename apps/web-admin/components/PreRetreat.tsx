"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { OPEN_HREF, openTarget } from "../../../domains/retreat/pre-retreat.ts";

type Retreat = {
  id: string;
  name: string;
  status: string;
  arrival: string;
  departure: string;
  day_before: string;
  day_before_is_today: boolean;
};

type Line = { key: string; label: string; state: "open" | "done"; detail: string };

type Detail = {
  note: string;
  booking: { id: string; name: string; status: string; arrival: string; departure: string };
  day_before: string | null;
  lines: Line[];
  safety_parts: Line[];
  ready: boolean;
};

const fmt = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function LineControl({ state, lineKey, label }: { state: "open" | "done"; lineKey: string; label: string }) {
  const href = openTarget(state, lineKey);
  if (!href) return <span>Done</span>;
  return <a className="linkbtn" href={href} style={{ fontSize: "inherit" }} aria-label={`Open ${label}`}>Open</a>;
}

export default function PreRetreat() {
  const [items, setItems] = useState<Retreat[] | null>(null);
  const [id, setId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    api<{ note: string; items: Retreat[] }>("/v1/pre-retreat")
      .then(r => {
        setNote(r.note);
        setItems(r.items);
        const today = r.items.find(i => i.day_before_is_today);
        setId(today?.id ?? r.items[0]?.id ?? "");
      })
      .catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not load retreats."));
  }, []);

  useEffect(() => {
    if (!id) { setDetail(null); return; }
    let live = true;
    setDetail(null);
    setError("");
    api<Detail>(`/v1/pre-retreat/${id}`)
      .then(d => { if (live) setDetail(d); })
      .catch(e => { if (live) setError(e instanceof ApiError ? e.problem.detail : "Could not load this retreat."); });
    return () => { live = false; };
  }, [id]);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 880 }}>
      <div className="kicker">Wave 1 · Staff</div>
      <h1 style={{ marginTop: 0 }}>Pre-retreat readiness</h1>
      <p>One view for the day before an existing retreat. {note || "Each line stays open until a real record exists."}</p>

      {error && <div className="note" role="alert">{error}</div>}
      {items && items.length === 0 && <p>No retreat is on the board. Nothing here is marked ready.</p>}

      {items && items.length > 0 && (
        <label>Retreat
          <select className="readiness-select" value={id} onChange={e => setId(e.target.value)}>
            {items.map(g => (
              <option key={g.id} value={g.id}>
                {g.name} · day before {g.day_before} · arrives {g.arrival}
              </option>
            ))}
          </select>
        </label>
      )}

      {id && !detail && !error && <p>Loading the records for this retreat…</p>}

      {detail && (
        <section className="house-panel" style={{ marginTop: 16 }}>
          <div className="k">{detail.booking.status} · day before {detail.day_before ? fmt(detail.day_before) : "not recorded"}</div>
          <h2>{detail.booking.name}</h2>
          <p>Arrival {fmt(detail.booking.arrival)} · departure {fmt(detail.booking.departure)}.</p>
          <p>{detail.ready ? "Every recorded line is done." : "Not ready. Open lines stay open until a real record exists."}</p>
          {detail.lines.map(line => (
            <div key={line.key} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{line.label}</strong>
                <LineControl state={line.state} lineKey={line.key} label={line.label} />
              </div>
              <p className="m" style={{ margin: "4px 0 0" }}>{line.detail}</p>
              {line.key === "safety" && detail.safety_parts.map(part => (
                <div key={part.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, paddingLeft: 12 }}>
                  <span>{part.label}<span className="m"> · {part.detail}</span></span>
                  <LineControl state={part.state} lineKey={part.key} label={part.label} />
                </div>
              ))}
            </div>
          ))}
          <p className="m">Records are read from the room board, the programme menu, the rota, purchases already marked placed, and safety notes saved for this retreat.</p>
          <p className="m">
            <a href={OPEN_HREF.rooms}>Room board</a>
            {" · "}
            <a href={OPEN_HREF.meals}>Kitchen</a>
            {" · "}
            <a href={OPEN_HREF.rota}>Rota</a>
            {" · "}
            <a href={OPEN_HREF.suppliers}>Purchasing</a>
            {" · "}
            <a href={OPEN_HREF.safety}>Emergency and compliance</a>
          </p>
        </section>
      )}
    </div>
  );
}
