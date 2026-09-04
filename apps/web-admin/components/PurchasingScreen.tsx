"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Supplier = { id: string; name: string; code: string; contact_email: string | null; payment_terms: number };
type Requisition = { id: string; department: string; title: string; urgency: string; status: string; required_by: string | null; requested_by_name: string; item_count: number };
type PO = { id: string; number: string; department: string; order_date: string; status: string; total_gross: number | null; supplier_name: string };
type Invoice = { id: string; invoice_number: string; invoice_date: string; total_gross: number; status: string; match_status: string; supplier_name: string; po_number: string | null };

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(n);
const URG: Record<string, string> = { normal: "ENQUIRY", urgent: "PROVISIONAL", critical: "CANCELLED" };
const MATCH: Record<string, string> = { "3way_ok": "CONFIRMED", price_variance: "PROVISIONAL", qty_variance: "PROVISIONAL", no_po: "ENQUIRY" };

export default function PurchasingScreen() {
  const [tab, setTab] = useState<"requisitions" | "orders" | "invoices" | "suppliers">("requisitions");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [orders, setOrders] = useState<PO[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    api<{ items: Supplier[] }>("/v1/suppliers").then(r => setSuppliers(r.items)).catch(() => {});
    api<{ items: Requisition[] }>("/v1/requisitions").then(r => setRequisitions(r.items)).catch(() => {});
    api<{ items: PO[] }>("/v1/purchase-orders").then(r => setOrders(r.items)).catch(() => {});
    api<{ items: Invoice[] }>("/v1/supplier-invoices").then(r => setInvoices(r.items)).catch(() => {});
  }, []);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><div className="kicker">Operations</div><h1 style={{ margin: 0 }}>Purchasing</h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={() => {
            const dept = prompt("Department:"); if (!dept) return;
            const title = prompt("What do you need?"); if (!title) return;
            const urgency = prompt("Urgency (normal/urgent/critical):", "normal") ?? "normal";
            api<{ id: string }>("/v1/requisitions", { method: "POST", body: JSON.stringify({ department: dept, title, urgency, items: [] }) })
              .then(() => api<{ items: Requisition[] }>("/v1/requisitions").then(r => setRequisitions(r.items)))
              .then(() => say("Requisition submitted")).catch(() => say("Failed"));
          }}>+ Requisition</button>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Open requisitions", value: requisitions.filter(r => r.status === "submitted").length, chip: "ENQUIRY" },
          { label: "Active POs", value: orders.filter(o => !["delivered","invoiced","cancelled"].includes(o.status)).length, chip: "PROVISIONAL" },
          { label: "Unmatched invoices", value: invoices.filter(i => i.match_status !== "3way_ok" && i.status !== "paid").length, chip: "PROVISIONAL" },
          { label: "Suppliers", value: suppliers.length, chip: "CONFIRMED" },
        ].map(s => (
          <div key={s.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
            <div className="m" style={{ color: "var(--ink-2)", fontSize: 12, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="seg" style={{ marginBottom: 20 }}>
        {(["requisitions", "orders", "invoices", "suppliers"] as const).map(t => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "requisitions" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
            {["Department","Title","Urgency","Items","Required by","Requested by","Status",""].map(h => (
              <th key={h} style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {requisitions.map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                <td style={{ padding: "10px 12px" }}>{r.department}</td>
                <td style={{ padding: "10px 12px", fontWeight: 600 }}>{r.title}</td>
                <td style={{ padding: "10px 12px" }}><span className={`chip ${URG[r.urgency] ?? "ENQUIRY"}`} style={{ fontSize: 11 }}>{r.urgency}</span></td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{r.item_count}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{r.required_by ?? "—"}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{r.requested_by_name}</td>
                <td style={{ padding: "10px 12px" }}><span className={`chip ${r.status === "approved" ? "CONFIRMED" : r.status === "ordered" ? "IN_HOUSE" : r.status === "declined" ? "CANCELLED" : "ENQUIRY"}`} style={{ fontSize: 11 }}>{r.status}</span></td>
                <td style={{ padding: "10px 12px" }}>
                  {r.status === "submitted" && <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }} onClick={() => api(`/v1/requisitions/${r.id}/approve`, { method: "POST" }).then(() => say("Approved")).catch(() => {})}>Approve</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "orders" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
            {["PO Number","Supplier","Department","Date","Total","Status"].map(h => (
              <th key={h} style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                <td style={{ padding: "10px 12px", fontWeight: 600, fontFamily: "monospace" }}>{o.number}</td>
                <td style={{ padding: "10px 12px" }}>{o.supplier_name}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{o.department}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{o.order_date}</td>
                <td style={{ padding: "10px 12px", fontWeight: 600 }}>{o.total_gross ? gbp(o.total_gross) : "—"}</td>
                <td style={{ padding: "10px 12px" }}><span className={`chip ${o.status === "delivered" || o.status === "invoiced" ? "CONFIRMED" : o.status === "cancelled" ? "CANCELLED" : "PROVISIONAL"}`} style={{ fontSize: 11 }}>{o.status.replace(/_/g, " ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "invoices" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
            {["Invoice #","Supplier","PO","Date","Total","Match","Status"].map(h => (
              <th key={h} style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {invoices.map(i => (
              <tr key={i.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{i.invoice_number}</td>
                <td style={{ padding: "10px 12px" }}>{i.supplier_name}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)", fontFamily: "monospace" }}>{i.po_number ?? "—"}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{i.invoice_date}</td>
                <td style={{ padding: "10px 12px", fontWeight: 600 }}>{gbp(i.total_gross)}</td>
                <td style={{ padding: "10px 12px" }}><span className={`chip ${MATCH[i.match_status] ?? "ENQUIRY"}`} style={{ fontSize: 11 }}>{i.match_status?.replace(/_/g, " ") ?? "—"}</span></td>
                <td style={{ padding: "10px 12px" }}><span className={`chip ${i.status === "paid" ? "CONFIRMED" : i.status === "matched" ? "CONFIRMED" : i.status === "disputed" ? "CANCELLED" : "PROVISIONAL"}`} style={{ fontSize: 11 }}>{i.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "suppliers" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
            {["Code","Name","Contact","Payment terms"].map(h => (
              <th key={h} style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 600 }}>{s.code}</td>
                <td style={{ padding: "10px 12px", fontWeight: 600 }}>{s.name}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{s.contact_email ?? "—"}</td>
                <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{s.payment_terms} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
