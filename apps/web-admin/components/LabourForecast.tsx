"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type RotaRow = { shift_date: string; department: string; shifts: number; scheduled_hours: number };
type OccRow = { arrival_date: string; departure_date: string; guests: number };
type Expiring = { title: string; expires_at: string; display_name: string; email: string };

const DEPT_COLOUR: Record<string, string> = {
  kitchen: "#2d6a4f", housekeeping: "#b5838d", reception: "#1a3328",
  maintenance: "#e07a5f", grounds: "#6d6875", restaurant: "#f2cc8f",
};

export default function LabourForecast() {
  const [rota, setRota] = useState<RotaRow[]>([]);
  const [occupancy, setOccupancy] = useState<OccRow[]>([]);
  const [expiring, setExpiring] = useState<Expiring[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);

  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1 + weekOffset * 7);
  const from = monday.toISOString().slice(0, 10);
  const to = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    api<{ rota: RotaRow[]; occupancy: OccRow[] }>(`/v1/labour/forecast?from=${from}&to=${to}`)
      .then(r => { setRota(r.rota); setOccupancy(r.occupancy); }).catch(() => {});
    api<{ items: Expiring[] }>("/v1/training/expiring").then(r => setExpiring(r.items)).catch(() => {});
  }, [from, to]);

  // Build 7-day grid
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }

  const depts = [...new Set(rota.map(r => r.department))].sort();

  // Hours by dept+date
  const hoursMap: Record<string, Record<string, number>> = {};
  for (const r of rota) {
    if (!hoursMap[r.department]) hoursMap[r.department] = {};
    hoursMap[r.department][r.shift_date] = (hoursMap[r.department][r.shift_date] ?? 0) + Number(r.scheduled_hours);
  }

  // Guests in house per day
  const guestsMap: Record<string, number> = {};
  for (const d of days) {
    let g = 0;
    for (const o of occupancy) { if (o.arrival_date <= d && o.departure_date > d) g += Number(o.guests ?? 0); }
    guestsMap[d] = g;
  }

  const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div><div className="kicker">HR</div><h1 style={{ margin: 0 }}>Labour forecast</h1></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={() => setWeekOffset(w => w - 1)}>‹ Prev</button>
          <span style={{ padding: "0 12px", fontWeight: 600, fontSize: 14 }}>{fmtDay(from)} – {fmtDay(to)}</span>
          <button className="btn" onClick={() => setWeekOffset(w => w + 1)}>Next ›</button>
          <button className="btn" onClick={() => setWeekOffset(0)} style={{ color: "var(--ink-2)", fontSize: 12 }}>This week</button>
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="note" style={{ marginBottom: 20, background: "#fff3cd", borderColor: "#ffc107" }}>
          ⚠️ <b>{expiring.length} expiring certificates within 60 days:</b>{" "}
          {expiring.slice(0, 5).map(e => `${e.display_name} — ${e.title} (${e.expires_at})`).join("; ")}
          {expiring.length > 5 ? ` +${expiring.length - 5} more` : ""}
        </div>
      )}

      {/* Guest count strip */}
      <div style={{ display: "grid", gridTemplateColumns: `120px repeat(7, 1fr)`, gap: 4, marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 600, padding: "6px 8px" }}>Dept / Day</div>
        {days.map(d => (
          <div key={d} style={{ fontSize: 12, fontWeight: 600, padding: "6px 8px", background: "var(--surface-2)", borderRadius: 6, textAlign: "center" }}>
            <div>{fmtDay(d)}</div>
            <div style={{ color: "var(--ink-2)", fontSize: 11, marginTop: 2 }}>{guestsMap[d] ?? 0} guests</div>
          </div>
        ))}
      </div>

      {/* Hours grid by dept */}
      {depts.length === 0
        ? <p className="m" style={{ color: "var(--ink-2)", marginTop: 20 }}>No shifts scheduled for this week. Add shifts in HR & Rota.</p>
        : depts.map(dept => (
          <div key={dept} style={{ display: "grid", gridTemplateColumns: `120px repeat(7, 1fr)`, gap: 4, marginBottom: 4 }}>
            <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: DEPT_COLOUR[dept] ?? "#888", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{dept}</span>
            </div>
            {days.map(d => {
              const hrs = hoursMap[dept]?.[d] ?? 0;
              const guests = guestsMap[d] ?? 0;
              // Simple rule: flag if >20 guests and <4 hours scheduled
              const warn = guests > 20 && hrs < 4 && hrs > 0;
              const empty = hrs === 0 && guests > 10;
              return (
                <div key={d} style={{
                  padding: "8px 10px", borderRadius: 6, textAlign: "center",
                  background: empty ? "#fff3cd" : warn ? "#ffe0e0" : "var(--surface-2)",
                  fontSize: 13, fontWeight: hrs > 0 ? 600 : 400,
                  color: hrs === 0 ? "var(--ink-3)" : "var(--ink)",
                }}>
                  {hrs > 0 ? `${Number(hrs).toFixed(1)}h` : "—"}
                  {empty && <div style={{ fontSize: 10, color: "#b8860b" }}>⚠️ no cover</div>}
                </div>
              );
            })}
          </div>
        ))
      }

      {/* Total row */}
      {depts.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `120px repeat(7, 1fr)`, gap: 4, marginTop: 4, borderTop: "2px solid var(--rule)", paddingTop: 4 }}>
          <div style={{ padding: "8px 10px", fontWeight: 700, fontSize: 13 }}>Total hours</div>
          {days.map(d => {
            const total = depts.reduce((s, dept) => s + (hoursMap[dept]?.[d] ?? 0), 0);
            return (
              <div key={d} style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
                {total > 0 ? `${Number(total).toFixed(1)}h` : "—"}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <h3 style={{ marginBottom: 12 }}>Guidance</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { label: "Yellow cell", meaning: "Guests in house but no shifts scheduled for this dept" },
            { label: "Red cell", meaning: "Guests in house but less than 4h scheduled — may be understaffed" },
            { label: "Expiry banner", meaning: "Staff certificate expires within 60 days — arrange renewal" },
          ].map(g => (
            <div key={g.label} style={{ background: "var(--surface-2)", borderRadius: 8, padding: "12px 14px" }}>
              <b style={{ fontSize: 13 }}>{g.label}</b>
              <p className="m" style={{ color: "var(--ink-2)", marginTop: 4, fontSize: 13 }}>{g.meaning}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
