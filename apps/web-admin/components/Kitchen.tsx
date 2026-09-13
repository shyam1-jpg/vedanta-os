"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmt, addDays } from "@/lib/format";

type Day = { date: string; breakfast: number; lunch: number; dinner: number; groups: { id: string; name: string; colour: string; guests: number; meals: string[]; note?: string; dietary?: string; status: string }[] };
type Flag = { date: string; name: string; room: string; diet: string[] | null; allergens: string[] | null; severity: string | null; notes: string | null; group_name: string | null };
type FohOrder = { id: string; for_date: string; items: { name: string; qty: string }[]; notes: string | null; status: string; raised_by_name: string | null };

const TODAY = new Date().toISOString().slice(0, 10);
const LABEL: Record<string, string> = { celery: "celery", cereals_gluten: "gluten", crustaceans: "crustaceans", eggs: "eggs", fish: "fish", lupin: "lupin", milk: "milk", molluscs: "molluscs", mustard: "mustard", nuts: "tree nuts", peanuts: "peanuts", sesame: "sesame", soya: "soya", sulphites: "sulphites" };

const modules = [
  ["Tasks", "Open shift jobs, handovers and manager verification.", "/tasks/", "↗"],
  ["SOPs & manuals", "Open approved house procedures and operating guidance.", "/manual/", "↗"],
  ["Purchasing", "Supplier orders, approvals, deliveries and buying workflow.", "/purchasing/", "↗"],
  ["Maintenance", "Report equipment faults and follow repairs to completion.", "/maintenance/", "↗"],
  ["Staff & rota", "Kitchen staffing, labour and operational coverage.", "/staff-corner/", "↗"],
  ["Reports", "Review operational performance and management reporting.", "/reports/", "↗"],
] as const;

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
  const total = (d?: Day) => d ? d.breakfast + d.lunch + d.dinner : 0;
  const busiest = Math.max(1, ...days.flatMap(d => [d.breakfast, d.lunch, d.dinner]));
  const today = byDate.get(TODAY);
  const todayFlags = flags.filter(f => f.date === TODAY);
  const highRisk = todayFlags.filter(f => f.severity === "ANAPHYLAXIS" || f.severity === "ALLERGY");
  const todayOrders = orders.filter(o => o.for_date === TODAY || !o.for_date);
  const todayPeak = Math.max(today?.breakfast ?? 0, today?.lunch ?? 0, today?.dinner ?? 0);

  const nextMeal = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 10) return ["Breakfast", today?.breakfast ?? 0];
    if (hour < 15) return ["Lunch", today?.lunch ?? 0];
    return ["Dinner", today?.dinner ?? 0];
  }, [today]);

  const card: React.CSSProperties = { background: "var(--paper, #fff)", border: "1px solid var(--line, #e6e0d5)", borderRadius: 16, padding: 16, minHeight: 110 };
  const metric: React.CSSProperties = { fontSize: 30, fontWeight: 700, lineHeight: 1.05, marginTop: 8 };

  return (
    <>
      <div className="topbar">
        <div>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".12em", fontWeight: 800, color: "var(--gold, #9c7b3d)" }}>Kitchen operations</div>
          <h1>Kitchen command centre</h1>
          <p>Live covers, guest dietary risk, FOH requests and the operational tools needed to run the kitchen.</p>
        </div>
        <div className="seg"><button onClick={() => setStart(addDays(start, -7))} aria-label="Earlier">‹</button><button onClick={() => setStart(TODAY)}>This week</button><button onClick={() => setStart(addDays(start, 7))} aria-label="Later">›</button></div>
      </div>

      {err && <div className="note">Live kitchen data could not be loaded: {err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 }}>
        <div style={card}><div className="m">{nextMeal[0]} covers</div><div style={metric}>{nextMeal[1]}</div><div className="m">Next service · capacity {max}</div></div>
        <div style={card}><div className="m">Today peak</div><div style={metric}>{todayPeak}</div><div className="m">Highest single sitting</div></div>
        <div style={{ ...card, borderColor: highRisk.length ? "#b44" : "var(--line, #e6e0d5)" }}><div className="m">Allergy alerts</div><div style={metric}>{highRisk.length}</div><div className="m">Allergy / anaphylaxis flags today</div></div>
        <div style={card}><div className="m">FOH requests</div><div style={metric}>{todayOrders.length}</div><div className="m">Open requests requiring kitchen action</div></div>
      </div>

      <section style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, marginBottom: 10 }}>
          <div><h2 style={{ margin: 0 }}>Run the kitchen</h2><div className="m">One place for the main operational workflows.</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          {modules.map(([title, desc, href, icon]) => <Link key={href} href={href} style={{ ...card, minHeight: 122, textDecoration: "none", color: "inherit", display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{title}</strong><span aria-hidden="true">{icon}</span></div>
            <p className="m" style={{ marginTop: 12, lineHeight: 1.5 }}>{desc}</p>
          </Link>)}
        </div>
      </section>

      {orders.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Front of house needs</h3>
          {orders.map(o => (
            <div className="urow" key={o.id}>
              <div><div className="t">{o.for_date} · {o.items.map(i => `${i.qty} ${i.name}`).join(", ")}</div><div className="m">{o.raised_by_name}{o.notes ? ` · ${o.notes}` : ""}</div></div>
              <button className="btn" onClick={async () => { await api(`/v1/service/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }); setOrders(orders.filter(x => x.id !== o.id)); }}>Done</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div><h2 style={{ margin: 0 }}>Seven-day service forecast</h2><div className="m">Breakfast, lunch and dinner covers with group and dietary detail.</div></div>
      </div>

      <div className="kweek">
        {week.map(date => { const d = byDate.get(date); return (
          <section key={date} className={"kday" + (date === TODAY ? " today" : "") + (total(d) === 0 ? " quiet" : "")}>
            <h3>{fmt(date, { weekday: "long" })}<small>{fmt(date, { day: "numeric", month: "short" })}</small></h3>
            <div className="meals">
              {(["breakfast", "lunch", "dinner"] as const).map(m => { const n = d?.[m] ?? 0; return (
                <div key={m} className={"meal" + (n > max ? " over" : n === 0 ? " none" : "")}>
                  <span>{m}</span><b>{n}</b><i style={{ width: `${Math.min(100, (n / Math.max(busiest, max)) * 100)}%` }} />
                </div>); })}
            </div>
            {d?.groups.length ? <ul className="kgroups">{d.groups.map(g => (
              <li key={g.id}><i style={{ background: g.colour }} /><div><div className="n">{g.name} <span>{g.guests}</span></div>
                {g.note && <div className="m">{g.note} · {g.meals.length ? g.meals.join(", ") : "no meals"}</div>}
                {g.dietary && <div className="diet">{g.dietary}</div>}
                {g.status === "PROVISIONAL" && <div className="m warn">provisional</div>}
              </div></li>))}</ul> : <div className="m" style={{ color: "var(--ink-2)" }}>No groups in house.</div>}
            {flags.filter(f => f.date === date).length > 0 && <ul className="flags">{flags.filter(f => f.date === date).map(f => (
              <li key={f.name + f.room} className={f.severity === "ANAPHYLAXIS" ? "sev-high" : f.severity === "ALLERGY" ? "sev-mid" : "sev-low"}>
                <b>{f.name}</b> · room {f.room}{f.allergens?.length ? <> · <b>{f.allergens.map(a => LABEL[a] ?? a).join(", ")}</b>{f.severity === "ANAPHYLAXIS" ? " — life-threatening" : ""}</> : null}{f.diet?.length ? ` · ${f.diet.join(", ").replace(/_/g, " ")}` : ""}{f.notes ? ` · ${f.notes}` : ""}
              </li>))}</ul>}
          </section>); })}
      </div>
    </>
  );
}
