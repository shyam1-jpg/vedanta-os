"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type KPI = { this_month: string; revenue_received: number; revenue_agreed: number; balance_outstanding: number; occupancy_pct: number | null; adr: number | null; bookings: number; guest_nights: number; py_revenue: number; py_occupancy: number | null; ytd_purchasing_spend: number };
type MonthRow = { month: string; revenue_received: number; revenue_agreed: number; balance_outstanding: number; occupancy_pct: number | null; adr: number | null; bookings: number; guest_nights: number; purchasing: Record<string, { spend: number }>; budget: Record<string, number> };
type Summary = { months: MonthRow[]; ytd: { revenue_received: number; revenue_agreed: number; bookings: number; guest_nights: number; total_purchasing_spend: number }; year: number };

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
const pct = (n: number | null) => n == null ? "—" : n.toFixed(1) + "%";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function FinanceDashboard() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<"revenue" | "purchasing" | "sustainability">("revenue");
  const [sustainability, setSustainability] = useState<{ reading_date: string; category: string; value: number }[]>([]);

  useEffect(() => {
    api<KPI>("/v1/finance/kpi").then(setKpi).catch(() => {});
  }, []);

  useEffect(() => {
    api<Summary>(`/v1/finance/summary?year=${year}`).then(setSummary).catch(() => {});
  }, [year]);

  useEffect(() => {
    if (tab === "sustainability") {
      api<{ items: typeof sustainability }>("/v1/sustainability").then(r => setSustainability(r.items)).catch(() => {});
    }
  }, [tab]);

  const currentYear = new Date().getFullYear();

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div><div className="kicker">Finance</div><h1 style={{ margin: 0 }}>Dashboard</h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          {[currentYear - 1, currentYear, currentYear + 1].map(y => (
            <button key={y} className={year === y ? "btn primary" : "btn"} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      {kpi && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Revenue this month", value: gbp(kpi.revenue_received), sub: `of ${gbp(kpi.revenue_agreed)} agreed` },
            { label: "Balance outstanding", value: gbp(kpi.balance_outstanding), sub: "across all open folios" },
            { label: "Occupancy", value: pct(kpi.occupancy_pct), sub: kpi.py_occupancy ? `vs ${pct(kpi.py_occupancy)} last year` : "this month" },
            { label: "ADR", value: kpi.adr ? gbp(kpi.adr) : "—", sub: "average daily rate" },
            { label: "Bookings", value: String(kpi.bookings), sub: "this month" },
            { label: "YTD purchasing", value: gbp(kpi.ytd_purchasing_spend), sub: "all departments" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
              <div className="m" style={{ color: "var(--ink-2)", fontSize: 12, marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{k.value}</div>
              <div className="m" style={{ color: "var(--ink-3)", fontSize: 11, marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* YTD totals */}
      {summary && (
        <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 20px", marginBottom: 24, display: "flex", gap: 32 }}>
          <div><span className="m" style={{ color: "var(--ink-2)" }}>YTD Revenue received </span><b>{gbp(summary.ytd.revenue_received)}</b></div>
          <div><span className="m" style={{ color: "var(--ink-2)" }}>YTD Agreed </span><b>{gbp(summary.ytd.revenue_agreed)}</b></div>
          <div><span className="m" style={{ color: "var(--ink-2)" }}>YTD Bookings </span><b>{summary.ytd.bookings}</b></div>
          <div><span className="m" style={{ color: "var(--ink-2)" }}>YTD Guest nights </span><b>{summary.ytd.guest_nights}</b></div>
          <div><span className="m" style={{ color: "var(--ink-2)" }}>YTD Purchasing </span><b>{gbp(summary.ytd.total_purchasing_spend)}</b></div>
        </div>
      )}

      {/* Tabs */}
      <div className="seg" style={{ marginBottom: 16 }}>
        {(["revenue", "purchasing", "sustainability"] as const).map(t => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === "revenue" && summary && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Month</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Received</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Agreed</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Outstanding</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Occupancy</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>ADR</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Bookings</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Guest nights</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Budget</th>
            </tr>
          </thead>
          <tbody>
            {summary.months.map(m => {
              const monthIdx = parseInt(m.month.slice(5, 7)) - 1;
              const budgetRev = m.budget["revenue"] ?? null;
              const variance = budgetRev ? Number(m.revenue_received) - budgetRev : null;
              return (
                <tr key={m.month} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{MONTHS[monthIdx]} {m.month.slice(0, 4)}</td>
                  <td style={{ padding: "10px 12px" }}>{gbp(Number(m.revenue_received))}</td>
                  <td style={{ padding: "10px 12px" }}>{gbp(Number(m.revenue_agreed))}</td>
                  <td style={{ padding: "10px 12px", color: Number(m.balance_outstanding) > 0 ? "var(--danger)" : "var(--ink-2)" }}>{gbp(Number(m.balance_outstanding))}</td>
                  <td style={{ padding: "10px 12px" }}>{pct(m.occupancy_pct ? Number(m.occupancy_pct) : null)}</td>
                  <td style={{ padding: "10px 12px" }}>{m.adr ? gbp(Number(m.adr)) : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{m.bookings}</td>
                  <td style={{ padding: "10px 12px" }}>{m.guest_nights}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {budgetRev ? <span style={{ color: variance! >= 0 ? "var(--success, green)" : "var(--danger)" }}>{variance! >= 0 ? "+" : ""}{gbp(variance!)}</span> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === "purchasing" && summary && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Month</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Kitchen</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Maintenance</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Grounds</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Other</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {summary.months.map(m => {
              const monthIdx = parseInt(m.month.slice(5, 7)) - 1;
              const total = Object.values(m.purchasing ?? {}).reduce((s, v) => s + (v.spend ?? 0), 0);
              return (
                <tr key={m.month} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{MONTHS[monthIdx]}</td>
                  <td style={{ padding: "10px 12px" }}>{m.purchasing?.kitchen ? gbp(m.purchasing.kitchen.spend) : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{m.purchasing?.maintenance ? gbp(m.purchasing.maintenance.spend) : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{m.purchasing?.grounds ? gbp(m.purchasing.grounds.spend) : "—"}</td>
                  <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>—</td>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{total > 0 ? gbp(total) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === "sustainability" && (
        <div>
          {sustainability.length === 0
            ? <p className="m" style={{ color: "var(--ink-2)" }}>No sustainability readings yet. Record electricity, water, waste and food waste readings regularly.</p>
            : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Date</th>
                    <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Category</th>
                    <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {sustainability.map(r => (
                    <tr key={`${r.reading_date}-${r.category}`} style={{ borderBottom: "1px solid var(--rule)" }}>
                      <td style={{ padding: "10px 12px" }}>{r.reading_date}</td>
                      <td style={{ padding: "10px 12px" }}>{r.category.replace(/_/g, " ")}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  );
}
