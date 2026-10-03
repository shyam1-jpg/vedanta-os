"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DEFAULT_SUPPLIERS } from "../../../domains/finance/back-office.ts";
import { ACCOUNTS_NOT_CONNECTED, BLANK_TOTAL, NO_INVOICES_YET } from "../../../domains/finance/invoice-spend.ts";

type Read = { supplierName: string | null; supplierCode: string | null; localShop: boolean; date: string | null; total: number | null };
type PeriodKey = "day" | "week" | "month" | "year";
type PeriodMoney = {
  from: string; to: string; spend: number; income: number | null; profit: number | null;
  outcome: "profit" | "loss" | "even" | "income_missing"; pnlMessage: string;
  bookedIncome: number | null; forecast: number | null;
  forecastOutcome: "profit" | "loss" | "even" | "income_missing";
  bookingsLeftOut: number; forecastMessage: string;
};
type Item = {
  id: string; filename: string; date: string; total: number; supplierName: string;
  bookingId: string | null; bookingName: string | null; note: string | null;
};
type Retreat = { id: string; name: string; status: string; arrival: string | null; departure: string | null };
type Spend = {
  empty: boolean; message: string | null; accounts: string; anchor: string; incomeNote: string | null;
  periods?: Record<PeriodKey, PeriodMoney>;
  retreats?: { bookingId: string | null; name: string; spend: number }[];
  chart?: { year: string; points: { key: string; label: string; spend: number }[]; hasSpend: boolean };
  items: Item[];
  retreatsOnBook: Retreat[];
  localShops: string[];
};
type Draft = { supplierCode: string; localName: string; invoiceDate: string; total: string; bookingId: string; note: string };
type HeldFile = { name: string; data: string };

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const PERIODS: [PeriodKey, string][] = [["day", "This day"], ["week", "This week"], ["month", "This month"], ["year", "This year"]];
const blankDraft = (): Draft => ({ supplierCode: "", localName: "", invoiceDate: "", total: "", bookingId: "", note: "" });

function resultText(kind: PeriodMoney["outcome"], amount: number | null, missing: string): string {
  if (kind === "income_missing" || amount == null) return missing;
  if (kind === "even") return "Neither profit nor loss.";
  if (kind === "profit") return `Profit ${gbp(amount)}`;
  return `Loss ${gbp(Math.abs(amount))}`;
}

export default function InvoiceSpend() {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [anchor, setAnchor] = useState("");
  const [error, setError] = useState("");
  const [held, setHeld] = useState<HeldFile | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [busy, setBusy] = useState(false);

  const load = (next = anchor) => {
    const q = next ? `?anchor=${encodeURIComponent(next)}` : "";
    api<Spend>(`/v1/invoice-attachments/spend${q}`).then(data => {
      setSpend(data);
      if (!next) setAnchor(data.anchor);
    }).catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not load invoices."));
  };
  useEffect(() => { load(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (file: File | undefined) => {
    setError("");
    setHeld(null);
    setDraft(blankDraft());
    if (!file) return;
    if (file.size > 4_000_000) { setError("That file is too large."); return; }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsDataURL(file);
    }).catch((e: Error) => { setError(e.message); return ""; });
    if (!data) return;
    setBusy(true);
    try {
      const read = await api<Read>("/v1/invoice-attachments/read", { method: "POST", body: JSON.stringify({ data, filename: file.name }) });
      setHeld({ name: file.name, data });
      setDraft({
        supplierCode: read.supplierCode ?? (read.localShop ? "LOCAL" : ""),
        localName: read.localShop ? (read.supplierName ?? "") : "",
        invoiceDate: read.date ?? "",
        total: read.total == null ? "" : read.total.toFixed(2),
        bookingId: "",
        note: "",
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.detail : "Could not read the invoice.");
    } finally { setBusy(false); }
  };

  const supplierCode = draft.supplierCode.startsWith("local:") ? "LOCAL" : draft.supplierCode;
  const localName = draft.supplierCode.startsWith("local:") ? draft.supplierCode.slice(6) : draft.localName;
  const shopReady = Boolean(supplierCode) && (supplierCode !== "LOCAL" || localName.trim().length >= 2);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!held) return;
    if (!draft.total.trim()) { setError(BLANK_TOTAL); return; }
    setBusy(true);
    setError("");
    try {
      await api("/v1/invoice-attachments", { method: "POST", body: JSON.stringify({
        filename: held.name,
        data: held.data,
        supplierCode,
        localName,
        invoiceDate: draft.invoiceDate,
        total: draft.total,
        bookingId: draft.bookingId,
        note: draft.note,
      }) });
      setHeld(null);
      setDraft(blankDraft());
      load(anchor);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.detail : "Could not save the invoice.");
    } finally { setBusy(false); }
  };

  const openFile = async (id: string) => {
    setError("");
    try {
      const file = await api<{ data: string }>(`/v1/invoice-attachments/${id}`);
      const blob = await (await fetch(file.data)).blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.detail : "Could not open the invoice.");
    }
  };

  const periods = spend && !spend.empty ? spend.periods : undefined;
  const chart = spend && !spend.empty ? spend.chart : undefined;
  const maxBar = chart?.hasSpend ? Math.max(...chart.points.map(point => point.spend)) : 0;

  return (
    <section className="house-panel" style={{ marginTop: 8 }}>
      <h2>Invoice attachments</h2>
      <p>Attach an image or PDF. The house reads the supplier, date and total when they are written on the file. Anything it cannot read stays blank. You confirm the fields before they are saved as spend. A total is never guessed.</p>
      <p className="m">{spend?.accounts ?? ACCOUNTS_NOT_CONNECTED}</p>
      <p className="m">Guests do not pay for food. The restaurant is buffet only. The only point of sale is reception.</p>
      {error && <div className="note" role="alert">{error}</div>}

      <label style={{ display: "block", margin: "12px 0" }}>
        Invoice file
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={e => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </label>

      {held && (
        <form onSubmit={save} style={{ display: "grid", gap: 8, maxWidth: 720, marginBottom: 16 }}>
          <p className="m">Check these fields for {held.name}. Nothing is saved until you confirm. A field the file did not show is left blank.</p>
          <label>Shop
            <select value={draft.supplierCode} onChange={e => setDraft({ ...draft, supplierCode: e.target.value })}>
              <option value="">Choose a shop</option>
              <optgroup label="Regular">
                {DEFAULT_SUPPLIERS.filter(shop => shop.regular).map(shop => <option key={shop.code} value={shop.code}>{shop.name}</option>)}
              </optgroup>
              <optgroup label="Also used">
                {DEFAULT_SUPPLIERS.filter(shop => !shop.regular).map(shop => <option key={shop.code} value={shop.code}>{shop.name}</option>)}
              </optgroup>
              {(spend?.localShops.length ?? 0) > 0 && <optgroup label="Local shops already typed">
                {spend?.localShops.map(name => <option key={name} value={`local:${name}`}>{name}</option>)}
              </optgroup>}
              <option value="LOCAL">Another local shop</option>
            </select>
          </label>
          {(draft.supplierCode === "LOCAL" || draft.supplierCode.startsWith("local:")) && (
            <label>Local shop
              <input value={draft.supplierCode.startsWith("local:") ? draft.supplierCode.slice(6) : draft.localName} onChange={e => setDraft({ ...draft, supplierCode: "LOCAL", localName: e.target.value })} />
            </label>
          )}
          <label>Invoice date
            <input type="date" value={draft.invoiceDate} onChange={e => setDraft({ ...draft, invoiceDate: e.target.value })} />
          </label>
          <label>Total
            <input inputMode="decimal" value={draft.total} placeholder="Blank until you enter it" onChange={e => setDraft({ ...draft, total: e.target.value })} />
          </label>
          <label>Retreat
            <select value={draft.bookingId} onChange={e => setDraft({ ...draft, bookingId: e.target.value })}>
              <option value="">Unassigned</option>
              {(spend?.retreatsOnBook ?? []).map(retreat => (
                <option key={retreat.id} value={retreat.id}>{retreat.name}{retreat.arrival ? ` · ${retreat.arrival}` : ""} · {retreat.status}</option>
              ))}
            </select>
          </label>
          {(spend?.retreatsOnBook.length ?? 0) === 0 && <p className="m">No retreats are on the board. This invoice will be unassigned.</p>}
          <label>Note
            <input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <button className="btn primary" type="submit" disabled={busy || !draft.invoiceDate || !draft.total.trim() || !shopReady}>Save as spend</button>
        </form>
      )}

      <label style={{ display: "block", marginBottom: 12 }}>Date
        <input type="date" value={anchor} onChange={e => { setAnchor(e.target.value); load(e.target.value); }} />
      </label>

      {!spend && !error && <p className="m">Loading invoices…</p>}
      {spend?.empty && <p role="status">{spend.message ?? NO_INVOICES_YET}</p>}

      {periods && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, margin: "12px 0" }}>
            {PERIODS.map(([key, label]) => (
              <div key={key} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px" }}>
                <div className="m">{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{gbp(periods[key].spend)}</div>
                <div className="m">{periods[key].from} → {periods[key].to}</div>
              </div>
            ))}
          </div>

          <h3>Spend per retreat</h3>
          <p className="m">Retreat totals for {chart?.year}. An invoice that is not linked is Unassigned.</p>
          {(spend?.retreats?.length ?? 0) === 0
            ? <p>No attached invoices fall in {chart?.year}.</p>
            : <ul>{spend?.retreats?.map(row => <li key={row.bookingId ?? "unassigned"}>{row.name} · {gbp(row.spend)}</li>)}</ul>}

          <h3>Spend in {chart?.year}</h3>
          {chart && !chart.hasSpend && <p>No attached invoices fall in {chart.year}.</p>}
          {chart?.hasSpend && (
            <div aria-label={`Invoice spend in ${chart.year}`} style={{ display: "flex", gap: 8, alignItems: "end", minHeight: 160, marginBottom: 16 }}>
              {chart.points.map(point => (
                <div key={point.key} style={{ flex: 1, textAlign: "center" }}>
                  <div className="m">{gbp(point.spend)}</div>
                  <div style={{ height: `${Math.max(4, Math.round((point.spend / maxBar) * 120))}px`, background: "var(--forest, #1f3a32)", borderRadius: 4 }} />
                  <div className="m">{point.label}</div>
                </div>
              ))}
            </div>
          )}

          <h3>Expenditure, profit and loss</h3>
          {spend?.incomeNote && <p className="m">{spend.incomeNote}</p>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>{["Period", "Spend", "Income", "Profit or loss", "Forecast"].map(heading => <th key={heading} style={{ textAlign: "left", padding: 8 }}>{heading}</th>)}</tr>
              </thead>
              <tbody>
                {PERIODS.map(([key, label]) => {
                  const row = periods[key];
                  return (
                    <tr key={key} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: 8 }}>{label}</td>
                      <td style={{ padding: 8 }}>{gbp(row.spend)}</td>
                      <td style={{ padding: 8 }}>{row.income == null ? "Not recorded" : gbp(row.income)}</td>
                      <td style={{ padding: 8 }}>{resultText(row.outcome, row.profit, row.pnlMessage)}</td>
                      <td style={{ padding: 8 }}><div>{resultText(row.forecastOutcome, row.forecast, row.forecastMessage)}</div>{row.forecast != null && <div className="m">{row.forecastMessage}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(spend?.items.length ?? 0) > 0 && (
        <>
          <h3>Saved invoices</h3>
          {spend?.items.map(item => (
            <div key={item.id} className="panel" style={{ marginBottom: 8 }}>
              <div className="t">{item.date} · {item.supplierName} · {gbp(item.total)}</div>
              <div className="m">{item.bookingId ? (item.bookingName ?? "Unassigned") : "Unassigned"} · {item.filename}{item.note ? ` · ${item.note}` : ""}</div>
              <button className="btn" type="button" onClick={() => openFile(item.id)}>Open file</button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
