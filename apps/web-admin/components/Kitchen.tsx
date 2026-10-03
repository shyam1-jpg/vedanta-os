"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { fmt, addDays } from "@/lib/format";

type Day = { date: string; breakfast: number; lunch: number; dinner: number; groups: { id: string; name: string; colour: string; guests: number; meals: string[]; note?: string; dietary?: string; status: string }[] };
type Flag = { date: string; name: string; room: string; diet: string[] | null; allergens: string[] | null; severity: string | null; notes: string | null; group_name: string | null };
type FohOrder = { id: string; for_date: string; items: { name: string; qty: string }[]; notes: string | null; status: string; raised_by_name: string | null };

const TODAY = new Date().toISOString().slice(0, 10);
const LABEL: Record<string, string> = { celery: "celery", cereals_gluten: "gluten", crustaceans: "crustaceans", eggs: "eggs", fish: "fish", lupin: "lupin", milk: "milk", molluscs: "molluscs", mustard: "mustard", nuts: "tree nuts", peanuts: "peanuts", sesame: "sesame", soya: "soya", sulphites: "sulphites" };
const MEALS = ["breakfast", "lunch", "dinner"] as const;

const modules = [
  ["Tasks", "Open shift jobs, handovers and manager verification.", "/tasks/"],
  ["SOPs & manuals", "Open approved house procedures and operating guidance.", "/manual/"],
  ["Training", "What each department is already taught in the house book.", "/training/"],
  ["Purchasing", "Supplier orders, approvals, deliveries and buying workflow.", "/purchasing/"],
  ["Maintenance", "Report equipment faults and follow repairs to completion.", "/maintenance/"],
  ["Staff & rota", "Kitchen staffing, labour and operational coverage.", "/staff-corner/"],
  ["Reports", "Review operational performance and management reporting.", "/reports/"],
] as const;

const th: CSSProperties = { padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 };
const td: CSSProperties = { padding: "10px 12px" };

export default function Kitchen() {
  const [start, setStart] = useState(TODAY);
  const [days, setDays] = useState<Day[]>([]);
  const [max, setMax] = useState(130);
  const [err, setErr] = useState<string | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [orders, setOrders] = useState<FohOrder[]>([]);
  const end = addDays(start, 6);

  useEffect(() => {
    api<{ max_covers: number; days: Day[] }>(`/v1/covers?from=${start}&to=${end}`).then(r => { setDays(r.days); setMax(r.max_covers); setErr(null); }).catch(e => setErr(e.message));
    api<{ items: Flag[] }>(`/v1/guests/in-house?from=${start}&to=${end}`).then(r => setFlags(r.items)).catch(() => setFlags([]));
    api<{ orders: FohOrder[] }>("/v1/service/front-desk").then(r => setOrders(r.orders.filter(o => o.status !== "done"))).catch(() => setOrders([]));
  }, [start, end]);

  const byDate = new Map(days.map(d => [d.date, d]));
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = byDate.get(TODAY);
  const todayFlags = flags.filter(f => f.date === TODAY);
  const highRisk = todayFlags.filter(f => f.severity === "ANAPHYLAXIS" || f.severity === "ALLERGY");
  const todayOrders = orders.filter(o => o.for_date === TODAY || !o.for_date);
  const todayPeak = Math.max(today?.breakfast ?? 0, today?.lunch ?? 0, today?.dinner ?? 0);
  const groups = week.flatMap(date => (byDate.get(date)?.groups ?? []).map(g => ({ ...g, date })));

  const nextMeal = useMemo<[string, number]>(() => {
    const hour = new Date().getHours();
    if (hour < 10) return ["Breakfast", today?.breakfast ?? 0];
    if (hour < 15) return ["Lunch", today?.lunch ?? 0];
    return ["Dinner", today?.dinner ?? 0];
  }, [today]);

  const dayLabel = (date: string) => fmt(date, { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="kitchen-sheet" style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <div className="kicker">Kitchen</div>
          <h1 style={{ margin: 0 }}>Covers</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn kitchen-no-print" onClick={() => setStart(addDays(start, -7))} aria-label="Earlier">‹ Prev</button>
          <span className="kitchen-range" style={{ padding: "0 12px", fontWeight: 600, fontSize: 14 }}>{dayLabel(start)} – {dayLabel(end)}</span>
          <button className="btn kitchen-no-print" onClick={() => setStart(addDays(start, 7))} aria-label="Later">Next ›</button>
          <button className="btn kitchen-no-print" onClick={() => setStart(TODAY)} style={{ color: "var(--ink-2)", fontSize: 12 }}>This week</button>
          <button className="btn kitchen-no-print" type="button" onClick={() => window.print()}>Print week</button>
        </div>
      </div>

      <p>Pure vegetarian. No eggs and no onion-family ingredients. Dairy is not taken from the retreat cows. Guests do not pay for food.</p>

      {err && <div className="note">Live kitchen data could not be loaded: {err}</div>}

      {highRisk.length > 0 && (
        <div className="note kitchen-alert" style={{ marginBottom: 20, background: "#fff3cd", borderColor: "#ffc107" }}>
          <b>{highRisk.length} allergy or anaphylaxis {highRisk.length === 1 ? "flag" : "flags"} today:</b>{" "}
          {highRisk.map(f => `${f.name}${f.room ? `, room ${f.room}` : ""}`).join("; ")}
        </div>
      )}

      <div className="kitchen-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: `${nextMeal[0]} covers`, value: nextMeal[1], sub: `Next service · capacity ${max}` },
          { label: "Today peak", value: todayPeak, sub: "Highest single sitting" },
          { label: "Allergy alerts", value: highRisk.length, sub: "Allergy / anaphylaxis flags today" },
          { label: "FOH requests", value: todayOrders.length, sub: "Open requests requiring kitchen action" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
            <div className="m" style={{ color: "var(--ink-2)", fontSize: 12, marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{k.value}</div>
            <div className="m" style={{ color: "var(--ink-3)", fontSize: 11, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Seven-day service</h3>
      <div className="kitchen-grid" style={{ display: "grid", gridTemplateColumns: "120px repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 600, padding: "6px 8px" }}>Service</div>
        {week.map(date => (
          <div key={date} style={{ fontSize: 12, fontWeight: 600, padding: "6px 8px", background: "var(--surface-2)", borderRadius: 6, textAlign: "center" }}>
            <div>{fmt(date, { weekday: "short" })}</div>
            <div style={{ color: "var(--ink-2)", fontSize: 11, marginTop: 2 }}>{fmt(date, { day: "numeric", month: "short" })}{date === TODAY ? " · today" : ""}</div>
          </div>
        ))}
      </div>
      {MEALS.map(meal => (
        <div key={meal} className="kitchen-grid" style={{ display: "grid", gridTemplateColumns: "120px repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
          <div style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{meal}</div>
          {week.map(date => {
            const n = byDate.get(date)?.[meal] ?? 0;
            const over = n > max;
            return (
              <div key={date} className={over ? "kitchen-over" : undefined} style={{
                padding: "8px 10px", borderRadius: 6, textAlign: "center",
                background: over ? "#ffe0e0" : "var(--surface-2)",
                fontSize: 13, fontWeight: n > 0 ? 600 : 400,
                color: n === 0 ? "var(--ink-3)" : "var(--ink)",
              }}>
                {n}
                {over && <div style={{ fontSize: 10, color: "var(--brick)" }}>over {max}</div>}
              </div>
            );
          })}
        </div>
      ))}
      <p className="m" style={{ color: "var(--ink-2)", marginTop: 8 }}>A red cell is over the house capacity of {max}.</p>

      <h3 style={{ margin: "28px 0 12px" }}>Groups</h3>
      {groups.length === 0
        ? <p className="m" style={{ color: "var(--ink-2)" }}>No groups in house.</p>
        : (
          <table className="kitchen-groups" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
                {["Day", "Group", "Guests", "Meals", "Note", "Dietary", "Status"].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.date + g.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{fmt(g.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td style={td}>
                    <span className="kitchen-swatch" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: g.colour, marginRight: 8 }} />
                    {g.name}
                  </td>
                  <td style={td}>{g.guests}</td>
                  <td style={{ ...td, color: "var(--ink-2)" }}>{g.meals.length ? g.meals.join(", ") : "no meals"}</td>
                  <td style={{ ...td, color: "var(--ink-2)" }}>{g.note || "—"}</td>
                  <td style={td}>{g.dietary || "—"}</td>
                  <td style={td}>{g.status === "PROVISIONAL" ? <span className="chip PROVISIONAL" style={{ fontSize: 11 }}>provisional</span> : g.status ? <span className="chip CONFIRMED" style={{ fontSize: 11 }}>{g.status.replace(/_/g, " ").toLowerCase()}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h3 style={{ margin: "28px 0 12px" }}>Dietary flags</h3>
      {flags.length === 0
        ? <p className="m" style={{ color: "var(--ink-2)" }}>No dietary flags in this week.</p>
        : week.map(date => {
          const dayFlags = flags.filter(f => f.date === date);
          if (!dayFlags.length) return null;
          return (
            <div key={date} className="kitchen-day" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{fmt(date, { weekday: "long", day: "numeric", month: "short" })}</div>
              <ul className="flags">
                {dayFlags.map(f => (
                  <li key={f.name + f.room + date} className={f.severity === "ANAPHYLAXIS" ? "sev-high" : f.severity === "ALLERGY" ? "sev-mid" : "sev-low"}>
                    <b>{f.name}</b> · room {f.room}{f.allergens?.length ? <> · <b>{f.allergens.map(a => LABEL[a] ?? a).join(", ")}</b>{f.severity === "ANAPHYLAXIS" ? " — life-threatening" : ""}</> : null}{f.diet?.length ? ` · ${f.diet.join(", ").replace(/_/g, " ")}` : ""}{f.notes ? ` · ${f.notes}` : ""}{f.group_name ? ` · ${f.group_name}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

      <h3 style={{ margin: "28px 0 12px" }}>Front of house</h3>
      {orders.length === 0
        ? <p className="m" style={{ color: "var(--ink-2)" }}>No open requests.</p>
        : (
          <table className="kitchen-orders" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
                {["Date", "Items", "Raised by", "Notes", ""].map(h => <th key={h || "action"} className={h ? undefined : "kitchen-no-print"} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{o.for_date || "—"}</td>
                  <td style={td}>{o.items.map(i => `${i.qty} ${i.name}`).join(", ")}</td>
                  <td style={{ ...td, color: "var(--ink-2)" }}>{o.raised_by_name || "—"}</td>
                  <td style={{ ...td, color: "var(--ink-2)" }}>{o.notes || "—"}</td>
                  <td className="kitchen-no-print" style={td}>
                    <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }} onClick={async () => { await api(`/v1/service/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }); setOrders(orders.filter(x => x.id !== o.id)); }}>Done</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <div className="kitchen-no-print" style={{ marginTop: 28 }}>
        <h3 style={{ marginBottom: 12 }}>Open</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {modules.map(([title, desc, href]) => (
            <Link key={href} href={href} style={{ background: "var(--surface-2)", borderRadius: 8, padding: "12px 14px", textDecoration: "none", color: "inherit" }}>
              <b style={{ fontSize: 13 }}>{title}</b>
              <p className="m" style={{ color: "var(--ink-2)", marginTop: 4, fontSize: 13 }}>{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
