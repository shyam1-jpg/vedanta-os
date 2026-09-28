"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

type Category = { code: string; name: string };
type Card = {
  code: string; name: string; spent: string; budget: string; remaining: string;
  colour: "green" | "amber" | "red"; pace_label: string; days_left: number;
};
type Expense = {
  id: string; amount: string; amount_input: string; category: string; spent_on: string; description: string;
  review: string; review_note: string | null; has_receipt: boolean;
  department: string; department_name: string; spent_by: string; spent_by_name: string;
  logged_by_name: string; supplier_id: string | null; supplier_name: string | null;
  ticket_id: string | null; ticket_label: string | null; stock_log_id: string | null; stock_name: string | null;
  may_edit: boolean; may_review: boolean;
};
type Board = {
  month: string; month_label: string; can_set: boolean; can_log: boolean; sees_all: boolean; department: string | null;
  categories: Category[]; cards: Card[]; expenses: Expense[];
  people: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  tickets: { id: string; label: string }[];
  restocks: { id: string; name: string }[];
};
type Report = {
  by_department: { name: string; spent: string; budget: string }[];
  by_category: { name: string; spent: string }[];
  trend: { month: string; label: string; spent_pence: number; spent: string }[];
};
type SpendSettings = { gm_email: string; notify_heads: boolean; categories: Category[] };

const emptyForm = { amount: "", category: "supplies", spent_on: "", spent_by: "", department: "", supplier_id: "", ticket_id: "", stock_log_id: "", description: "", receipt: "" as string | null };

async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Attach a photo as an image"));
      el.src = url;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the photo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
    if (!data.startsWith("data:image/") || data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export default function Spend() {
  const [month, setMonth] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [trend, setTrend] = useState<6 | 12>(6);
  const [report, setReport] = useState<Report | null>(null);
  const [settings, setSettings] = useState<SpendSettings | null>(null);
  const [budgetDept, setBudgetDept] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const say = (text: string) => { setToast(text); setTimeout(() => setToast(null), 3500); };

  const load = (next = month) => {
    const q = next ? `?month=${encodeURIComponent(next)}` : "";
    api<Board>(`/v1/spend${q}`).then(data => { setBoard(data); if (!month) setMonth(data.month); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not load spend"));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => {
    if (!month) return;
    api<Report>(`/v1/spend/report?month=${encodeURIComponent(month)}&trend=${trend}`).then(setReport).catch(() => {});
  }, [month, trend]);
  useEffect(() => {
    if (!board?.can_set) return;
    api<SpendSettings>("/v1/spend/settings").then(setSettings).catch(() => {});
  }, [board?.can_set]);

  const save = async () => {
    const body = {
      amount: form.amount,
      category: form.category,
      spent_on: form.spent_on || undefined,
      spent_by: form.spent_by || undefined,
      department: board?.sees_all ? form.department : undefined,
      supplier_id: form.supplier_id || null,
      ticket_id: form.ticket_id || null,
      stock_log_id: form.stock_log_id || null,
      description: form.description,
      ...(form.receipt !== "" ? { receipt: form.receipt } : {}),
    };
    if (editing) await api(`/v1/spend/expenses/${editing}`, { method: "PATCH", body: JSON.stringify(body) });
    else await api("/v1/spend/expenses", { method: "POST", body: JSON.stringify(body) });
    setForm(emptyForm);
    setEditing(null);
    say(editing ? "Spend updated" : "Spend logged");
    load();
  };

  const download = async (kind: "csv" | "pdf") => {
    const headers: Record<string, string> = {};
    const t = token.get(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/spend/report.${kind}?month=${encodeURIComponent(month)}&trend=${trend}`, { headers });
    if (!res.ok) { say("Could not download the report"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-${month}.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const rows = (board?.expenses ?? []).filter(row => !filter || row.department === filter);
  const maxTrend = Math.max(1, ...(report?.trend.map(row => row.spent_pence) ?? [1]));
  const categories = board?.categories ?? [];

  return (
    <div className="spend-board" data-testid="spend-dashboard">
      {toast && <p className="toast" role="status">{toast}</p>}
      <div className="topbar">
        <div>
          <h1>Spending</h1>
          <p className="m">{board?.month_label ?? "This month"} · pounds, against each department budget</p>
        </div>
        <label>Month
          <input aria-label="Month" type="month" value={month} onChange={e => { setMonth(e.target.value); setFilter(""); load(e.target.value); }} />
        </label>
      </div>
      <div className="spend-grid">
        {(board?.cards ?? []).map(card => (
          <button key={card.code} type="button" className={`spend-card ${card.colour}${filter === card.code ? " on" : ""}`} data-testid={`spend-card-${card.code}`} data-band={card.colour} onClick={() => setFilter(filter === card.code ? "" : card.code)}>
            <strong>{card.name}</strong>
            <span>{card.spent} of {card.budget}</span>
            <span>{card.remaining} left</span>
            <em>{card.pace_label}</em>
          </button>
        ))}
      </div>
      {filter && <p className="m"><button className="btn" type="button" onClick={() => setFilter("")}>Show every department</button></p>}

      {board?.can_log && (
        <form className="panel spend-form" onSubmit={e => { e.preventDefault(); save().catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not save the spend")); }}>
          <h3>{editing ? "Change this spend" : "Log a spend"}</h3>
          <label>Amount, pounds<input aria-label="Amount" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></label>
          <label>Category
            <select aria-label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {categories.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
              {form.category && !categories.some(item => item.code === form.category) && <option value={form.category}>{form.category}</option>}
            </select>
          </label>
          <label>Date<input aria-label="Date" type="date" value={form.spent_on} onChange={e => setForm({ ...form, spent_on: e.target.value })} /></label>
          {board.sees_all && (
            <label>Department
              <select aria-label="Department" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} required>
                <option value="">Choose</option>
                {board.cards.map(card => <option key={card.code} value={card.code}>{card.name}</option>)}
              </select>
            </label>
          )}
          <label>Who spent it
            <select aria-label="Who spent it" value={form.spent_by} onChange={e => setForm({ ...form, spent_by: e.target.value })}>
              <option value="">Me</option>
              {board.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          <label>Supplier
            <select aria-label="Supplier" value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">None</option>
              {board.suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Maintenance ticket
            <select aria-label="Maintenance ticket" value={form.ticket_id} onChange={e => setForm({ ...form, ticket_id: e.target.value })}>
              <option value="">None</option>
              {board.tickets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>Stock restock
            <select aria-label="Stock restock" value={form.stock_log_id} onChange={e => setForm({ ...form, stock_log_id: e.target.value })}>
              <option value="">None</option>
              {board.restocks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>What it was for<textarea aria-label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required /></label>
          <label>Receipt photo
            <input aria-label="Receipt" type="file" accept="image/*" onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              try { const photo = await shrinkPhoto(file); setForm(current => ({ ...current, receipt: photo })); }
              catch (err) { say(err instanceof Error ? err.message : "Could not read the photo"); }
            }} />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn primary" type="submit" data-testid="spend-save">{editing ? "Save changes" : "Log spend"}</button>
            {editing && <button className="btn" type="button" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancel</button>}
          </div>
        </form>
      )}

      <div className="panel" id="spend-list">
        <h3>{filter ? board?.cards.find(card => card.code === filter)?.name : "This month"}</h3>
        {rows.length === 0 && <p className="m">Nothing logged for this view.</p>}
        {rows.map(row => (
          <article key={row.id} className="spend-row" data-testid="spend-row">
            <div>
              <strong>{row.amount}</strong> · {categories.find(item => item.code === row.category)?.name ?? row.category} · {row.department_name}
              <div className="m">{row.spent_on} · {row.spent_by_name} · logged by {row.logged_by_name}</div>
              <div>{row.description}</div>
              <div className="m">{[row.supplier_name, row.ticket_label, row.stock_name].filter(Boolean).join(" · ")}{row.review !== "open" ? ` · ${row.review}` : ""}{row.review_note ? ` — ${row.review_note}` : ""}</div>
            </div>
            <div className="spend-actions">
              {row.has_receipt && <button className="btn" type="button" onClick={() => api<{ receipt: string | null }>(`/v1/spend/expenses/${row.id}`).then(data => setReceipt(data.receipt)).catch(() => say("Could not open the receipt"))}>Receipt</button>}
              {row.may_edit && <button className="btn" type="button" onClick={() => { setEditing(row.id); setForm({ amount: row.amount_input, category: row.category, spent_on: row.spent_on, spent_by: row.spent_by, department: row.department, supplier_id: row.supplier_id ?? "", ticket_id: row.ticket_id ?? "", stock_log_id: row.stock_log_id ?? "", description: row.description, receipt: "" }); }}>Edit</button>}
              {row.may_edit && <button className="btn" type="button" onClick={() => { if (!window.confirm("Remove this spend?")) return; api(`/v1/spend/expenses/${row.id}`, { method: "DELETE" }).then(() => { say("Spend removed"); load(); }).catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not remove it")); }}>Remove</button>}
              {row.may_review && row.review !== "checked" && <button className="btn" type="button" onClick={() => api(`/v1/spend/expenses/${row.id}/review`, { method: "POST", body: JSON.stringify({ review: "checked" }) }).then(() => load()).catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not mark it"))}>Checked</button>}
              {row.may_review && row.review !== "queried" && <button className="btn" type="button" onClick={() => api(`/v1/spend/expenses/${row.id}/review`, { method: "POST", body: JSON.stringify({ review: "queried" }) }).then(() => load()).catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not mark it"))}>Queried</button>}
            </div>
          </article>
        ))}
      </div>

      {report && (
        <div className="panel">
          <h3>Monthly report</h3>
          <div className="spend-bars" data-testid="spend-trend">
            {report.trend.map(row => (
              <div key={row.month} title={`${row.label} ${row.spent}`}>
                <i style={{ height: `${Math.max(4, Math.round(row.spent_pence / maxTrend * 100))}%` }} />
                <span>{row.label.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <p>
            <button className="btn" type="button" onClick={() => setTrend(trend === 6 ? 12 : 6)}>{trend === 6 ? "Show 12 months" : "Show 6 months"}</button>
            <button className="btn" type="button" onClick={() => download("csv")}>Download CSV</button>
            <button className="btn" type="button" data-testid="spend-pdf" onClick={() => download("pdf")}>Download PDF</button>
          </p>
          <h4>By department</h4>
          <ul>{report.by_department.map(row => <li key={row.name}>{row.name}: {row.spent} of {row.budget}</li>)}</ul>
          <h4>By category</h4>
          <ul>{report.by_category.map(row => <li key={row.name}>{row.name}: {row.spent}</li>)}</ul>
        </div>
      )}

      {board?.can_set && (
        <form className="panel spend-form" onSubmit={e => { e.preventDefault(); api("/v1/spend/budgets", { method: "PUT", body: JSON.stringify({ department: budgetDept, month, amount: budgetAmount }) }).then(() => { say("Budget saved"); setBudgetAmount(""); load(); }).catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not save the budget")); }}>
          <h3>Department budget</h3>
          <label>Department
            <select aria-label="Budget department" value={budgetDept} onChange={e => setBudgetDept(e.target.value)} required>
              <option value="">Choose</option>
              {(board.cards).map(card => <option key={card.code} value={card.code}>{card.name}</option>)}
            </select>
          </label>
          <label>Amount, pounds<input aria-label="Budget amount" inputMode="decimal" value={budgetAmount} onChange={e => setBudgetAmount(e.target.value)} required /></label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn primary" type="submit">Save this month</button>
            <button className="btn" type="button" onClick={() => api<{ copied: number }>("/v1/spend/budgets/copy", { method: "POST", body: JSON.stringify({ month }) }).then(data => { say(data.copied ? `Copied ${data.copied} from last month` : "Last month is already copied"); load(); }).catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not copy last month"))}>Copy last month</button>
          </div>
        </form>
      )}

      {settings && (
        <form className="panel spend-form" onSubmit={e => { e.preventDefault(); api<SpendSettings>("/v1/spend/settings", { method: "PUT", body: JSON.stringify(settings) }).then(data => { setSettings(data); say("Spend alerts saved"); load(); }).catch(err => say(err instanceof ApiError ? err.problem.detail : "Could not save alerts")); }}>
          <h3>Who hears when a budget is nearly used</h3>
          <p className="m">At 80% and at 100%, once each month. The department head is told when that is on. Add the general manager, or Shyam, here.</p>
          <label>General manager email<input aria-label="Spend alert email" type="email" value={settings.gm_email} onChange={e => setSettings({ ...settings, gm_email: e.target.value })} /></label>
          <label><input type="checkbox" checked={settings.notify_heads} onChange={e => setSettings({ ...settings, notify_heads: e.target.checked })} /> Tell the department head as well</label>
          <label>Categories, one name per line
            <textarea aria-label="Categories" value={settings.categories.map(item => item.name).join("\n")} onChange={e => setSettings({ ...settings, categories: e.target.value.split("\n").map(name => name.trim()).filter(Boolean).map(name => ({ code: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name })) })} />
          </label>
          <button className="btn primary" type="submit" style={{ marginTop: 12 }}>Save alerts</button>
        </form>
      )}

      {receipt && (
        <div className="org-sheet" role="dialog">
          <button className="btn" type="button" onClick={() => setReceipt(null)}>Close</button>
          <img alt="Receipt" src={receipt} style={{ width: "100%", marginTop: 12 }} />
        </div>
      )}
    </div>
  );
}
