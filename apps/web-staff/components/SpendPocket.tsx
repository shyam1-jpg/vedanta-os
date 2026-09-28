"use client";
import { useEffect, useState } from "react";
import { API, api, shrinkPhoto, tok } from "@/lib/client";

type Category = { code: string; name: string };
type Card = { code: string; name: string; spent: string; budget: string; remaining: string; colour: string; pace_label: string };
type Expense = {
  id: string; amount: string; category: string; spent_on: string; description: string; review: string;
  department: string; department_name: string; spent_by: string; spent_by_name: string;
  may_edit: boolean; may_review: boolean; has_receipt: boolean;
};
type Board = {
  month: string; month_label: string; can_set: boolean; sees_all: boolean; categories: Category[];
  cards: Card[]; expenses: Expense[]; people: { id: string; name: string }[];
  suppliers: { id: string; name: string }[]; tickets: { id: string; label: string }[]; restocks: { id: string; name: string }[];
};

export default function SpendPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("supplies");
  const [date, setDate] = useState("");
  const [who, setWho] = useState("");
  const [department, setDepartment] = useState("");
  const [supplier, setSupplier] = useState("");
  const [ticket, setTicket] = useState("");
  const [stock, setStock] = useState("");
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Board>("/v1/spend").then(setBoard).catch(e => onError((e as Error).message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const log = async () => {
    setBusy(true);
    onError(null);
    try {
      await api("/v1/spend/expenses", {
        method: "POST",
        body: JSON.stringify({
          amount, category, spent_on: date || undefined, spent_by: who || undefined,
          department: board?.sees_all ? department : undefined,
          supplier_id: supplier || null, ticket_id: ticket || null, stock_log_id: stock || null,
          description, ...(receipt ? { receipt } : {}),
        }),
      });
      setAmount(""); setDescription(""); setReceipt(null);
      await load();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const rows = (board?.expenses ?? []).filter(row => !filter || row.department === filter);
  const pdf = async () => {
    if (!board) return;
    const headers: Record<string, string> = {};
    const t = tok.get(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/spend/report.pdf?month=${encodeURIComponent(board.month)}&trend=6`, { headers });
    if (!res.ok) { onError("Could not download the PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-${board.month}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="pocket-spend">
      <div className="card">
        <h2>Spending</h2>
        <p className="m">{board?.month_label}. Green is under 80%, amber from 80%, red at the budget.</p>
        {(board?.cards ?? []).map(card => (
          <button key={card.code} type="button" className="btn" data-testid={`spend-card-${card.code}`} data-band={card.colour} onClick={() => setFilter(filter === card.code ? "" : card.code)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, borderTop: `4px solid ${card.colour === "red" ? "#a33b32" : card.colour === "amber" ? "#c48a12" : "#2f7d4a"}` }}>
            <strong>{card.name}</strong>
            <div>{card.spent} of {card.budget} · {card.remaining} left</div>
            <div className="m">{card.pace_label}</div>
          </button>
        ))}
      </div>
      <form className="card" onSubmit={e => { e.preventDefault(); log(); }}>
        <h2>Log a spend</h2>
        <label className="m">Amount, pounds<input aria-label="Amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required style={{ width: "100%" }} /></label>
        <label className="m">Category
          <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} style={{ width: "100%" }}>
            {(board?.categories ?? []).map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <label className="m">Date<input aria-label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%" }} /></label>
        {board?.sees_all && (
          <label className="m">Department
            <select aria-label="Department" value={department} onChange={e => setDepartment(e.target.value)} required style={{ width: "100%" }}>
              <option value="">Choose</option>
              {board.cards.map(card => <option key={card.code} value={card.code}>{card.name}</option>)}
            </select>
          </label>
        )}
        <label className="m">Who spent it
          <select aria-label="Who spent it" value={who} onChange={e => setWho(e.target.value)} style={{ width: "100%" }}>
            <option value="">Me</option>
            {(board?.people ?? []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <label className="m">Supplier
          <select aria-label="Supplier" value={supplier} onChange={e => setSupplier(e.target.value)} style={{ width: "100%" }}>
            <option value="">None</option>
            {(board?.suppliers ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="m">Maintenance ticket
          <select aria-label="Maintenance ticket" value={ticket} onChange={e => setTicket(e.target.value)} style={{ width: "100%" }}>
            <option value="">None</option>
            {(board?.tickets ?? []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="m">Stock restock
          <select aria-label="Stock restock" value={stock} onChange={e => setStock(e.target.value)} style={{ width: "100%" }}>
            <option value="">None</option>
            {(board?.restocks ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="m">What it was for<textarea aria-label="Description" value={description} onChange={e => setDescription(e.target.value)} required style={{ width: "100%" }} /></label>
        <label className="m">Receipt photo
          <input aria-label="Receipt" type="file" accept="image/*" onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            try { setReceipt(await shrinkPhoto(file)); } catch (err) { onError((err as Error).message); }
          }} />
        </label>
        <button className="btn primary" type="submit" disabled={busy} data-testid="spend-save">{busy ? "Saving" : "Log spend"}</button>
      </form>
      <div className="card">
        <h2>This month</h2>
        {rows.length === 0 && <p className="m">Nothing logged yet.</p>}
        {rows.map(row => (
          <article key={row.id} className="row" style={{ display: "block" }} data-testid="spend-row">
            <strong>{row.amount}</strong> · {board?.categories.find(item => item.code === row.category)?.name ?? row.category}
            <div className="m">{row.department_name} · {row.spent_on} · {row.spent_by_name}{row.review !== "open" ? ` · ${row.review}` : ""}</div>
            <div>{row.description}</div>
            {row.may_review && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button className="btn" type="button" onClick={() => api(`/v1/spend/expenses/${row.id}/review`, { method: "POST", body: JSON.stringify({ review: "checked" }) }).then(load).catch(e => onError((e as Error).message))}>Checked</button>
                <button className="btn" type="button" onClick={() => api(`/v1/spend/expenses/${row.id}/review`, { method: "POST", body: JSON.stringify({ review: "queried" }) }).then(load).catch(e => onError((e as Error).message))}>Queried</button>
              </div>
            )}
          </article>
        ))}
        <button className="btn" type="button" onClick={pdf}>Download PDF</button>
      </div>
    </div>
  );
}
