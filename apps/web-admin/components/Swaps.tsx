"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Violation = { code: string; severity: "hard" | "warn"; message: string };
type Shift = { id: string; user_id?: string; date: string; start: string; end: string; role_code: string | null; department?: string } | null;
type Item = {
  id: string;
  kind: string;
  status: string;
  open: boolean;
  reason: string;
  source: string;
  created_at: string;
  manager_note: string | null;
  requester: { id: string; name: string | null };
  partner: { id: string; name: string | null } | null;
  claimer: { id: string; name: string | null } | null;
  shift: Shift;
  partner_shift: Shift;
  review: { ok: boolean; violations: Violation[]; hours?: { userId: string; lieuBefore: number; lieuAfter: number }[] } | null;
};
type Detail = Item & {
  events: { action: string; from_status: string | null; to_status: string; note: string; by_name: string | null; created_at: string; payload: { hours?: { userId: string; lieuBefore: number; lieuAfter: number; weeklyBefore: number; weeklyAfter: number }[] } }[];
  assignments: { shift_id: string; from_user_id: string; to_user_id: string | null }[];
};
type Directory = {
  staff: { id: string; name: string; role: string; cleared: boolean }[];
  shifts: { id: string; user_id: string; name: string; date: string; start: string; end: string; role_code: string | null }[];
};
type Rule = {
  user_id: string;
  name: string;
  role: string;
  cleared: boolean;
  earliest_start: string | null;
  weekly_hours_cap: number | null;
  monthly_hours_cap: number | null;
  unavailable: string[];
  skills: string[];
};

const STATUSES = ["pending", "accepted", "declined", "approved", "rejected", "cancelled", "expired"];
const KINDS = ["swap", "cover", "day_off"];

function when(slot: Shift) {
  if (!slot) return "Shift no longer on the rota";
  return `${slot.date} ${slot.start}–${slot.end}`;
}

function Violations({ items }: { items: Violation[] }) {
  if (!items.length) return null;
  return (
    <ul data-testid="shift-swap-violations">
      {items.map((item, i) => <li key={i} className={item.severity === "hard" ? "swap-hard" : "swap-warn"}>{item.severity === "hard" ? "Blocked" : "Warning"}: {item.message}</li>)}
    </ul>
  );
}

export default function Swaps() {
  const [items, setItems] = useState<Item[]>([]);
  const [boardNote, setBoardNote] = useState("A manager approves before the rota changes.");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Rule>>({});
  const [shiftId, setShiftId] = useState("");
  const [swapKind, setSwapKind] = useState("cover");
  const [partnerId, setPartnerId] = useState("");
  const [partnerShiftId, setPartnerShiftId] = useState("");
  const [reason, setReason] = useState("");
  const [approveNow, setApproveNow] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };

  const load = async (nextStatus = status, nextKind = kind) => {
    const query = new URLSearchParams();
    if (nextStatus) query.set("status", nextStatus);
    if (nextKind) query.set("kind", nextKind);
    const suffix = query.toString();
    const list = await api<{ items: Item[]; board_note?: string }>(`/v1/shift-swaps${suffix ? `?${suffix}` : ""}`);
    setItems(list.items);
    if (list.board_note) setBoardNote(list.board_note);
  };

  useEffect(() => {
    load().catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open shift swaps"));
    api<Directory>("/v1/shift-swaps/directory").then(setDirectory).catch(() => {});
    api<{ items: Rule[] }>("/v1/shift-swaps/rules").then(r => setRules(r.items)).catch(() => {});
  }, []);

  const open = async (id: string) => {
    const row = await api<Detail>(`/v1/shift-swaps/${id}`);
    setOpenId(id);
    setDetail(row);
    setNote("");
  };

  const decide = async (action: "approve" | "reject") => {
    if (!openId) return;
    try {
      await api(`/v1/shift-swaps/${openId}/${action}`, { method: "POST", body: JSON.stringify({ note }) });
      say(action === "approve" ? "Approved. The rota is updated." : "Rejected. The rota is unchanged.");
      await load();
      await open(openId);
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not decide that swap"); }
  };

  const reassign = async () => {
    const shift = directory?.shifts.find(slot => slot.id === shiftId);
    if (!shift) return;
    try {
      await api("/v1/shift-swaps/reassign", {
        method: "POST",
        body: JSON.stringify({
          kind: swapKind,
          requester_id: shift.user_id,
          shift_id: shiftId,
          partner_id: partnerId || null,
          partner_shift_id: swapKind === "swap" ? partnerShiftId || null : null,
          reason,
          approve: approveNow,
          note: reason,
        }),
      });
      setReason("");
      say(approveNow ? "Reassigned and approved." : "Reassignment started.");
      await load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not start that reassignment"); }
  };

  const saveRule = async (rule: Rule) => {
    const draft = drafts[rule.user_id] ?? rule;
    try {
      await api(`/v1/shift-swaps/rules/${rule.user_id}`, {
        method: "PUT",
        body: JSON.stringify({
          earliest_start: draft.earliest_start,
          weekly_hours_cap: draft.weekly_hours_cap,
          monthly_hours_cap: draft.monthly_hours_cap,
          unavailable: draft.unavailable,
          skills: draft.skills,
        }),
      });
      say(`Saved rules for ${rule.name}`);
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save that rule"); }
  };

  const ruleOf = (rule: Rule) => drafts[rule.user_id] ?? rule;
  const partnerShifts = (directory?.shifts ?? []).filter(slot => slot.user_id === partnerId);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Shift swaps</h1>
          <p>The full history stays here. A named partner agrees first. {boardNote}</p>
        </div>
      </div>
      {toast && <div className="note">{toast}</div>}
      <div className="panel" data-testid="shift-swap-reassign">
        <h3>Start a swap or reassignment</h3>
        <div className="swap-form">
          <label>Shift
            <select data-testid="shift-swap-reassign-shift" value={shiftId} onChange={e => setShiftId(e.target.value)}>
              <option value="">Choose a shift</option>
              {(directory?.shifts ?? []).map(slot => <option key={slot.id} value={slot.id}>{slot.name} · {slot.date} {slot.start}–{slot.end}</option>)}
            </select>
          </label>
          <label>Kind
            <select data-testid="shift-swap-reassign-kind" value={swapKind} onChange={e => setSwapKind(e.target.value)}>
              <option value="swap">Two-way swap</option>
              <option value="cover">Cover</option>
              <option value="day_off">Day off</option>
            </select>
          </label>
          <label>Person
            <select data-testid="shift-swap-reassign-partner" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
              <option value="">Leave it open</option>
              {(directory?.staff ?? []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          {swapKind === "swap" && (
            <label>Their shift
              <select value={partnerShiftId} onChange={e => setPartnerShiftId(e.target.value)}>
                <option value="">Choose their shift</option>
                {partnerShifts.map(slot => <option key={slot.id} value={slot.id}>{slot.date} {slot.start}–{slot.end}</option>)}
              </select>
            </label>
          )}
          <label>Note
            <input data-testid="shift-swap-reassign-reason" value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <label className="m"><input type="checkbox" checked={approveNow} onChange={e => setApproveNow(e.target.checked)} /> Approve now</label>
          <button className="btn primary" type="button" data-testid="shift-swap-reassign-send" disabled={!shiftId} onClick={reassign}>Start</button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }} data-testid="shift-swap-list">
        <h3>History</h3>
        <div className="swap-form">
          <label>Status
            <select data-testid="shift-swap-filter-status" value={status} onChange={e => { setStatus(e.target.value); load(e.target.value, kind).catch(() => {}); }}>
              <option value="">All</option>
              {STATUSES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>Kind
            <select data-testid="shift-swap-filter-kind" value={kind} onChange={e => { setKind(e.target.value); load(status, e.target.value).catch(() => {}); }}>
              <option value="">All</option>
              {KINDS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {items.length === 0 && <p className="m">Nothing in this filter.</p>}
        <ul>
          {items.map(item => (
            <li key={item.id} data-testid="shift-swap-row">
              <button className="linkbtn" type="button" onClick={() => open(item.id).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open that swap"))}>
                {item.requester.name} · {item.kind} · {item.status}
              </button>
              <div className="m">{when(item.shift)}{item.partner ? ` · ${item.partner.name}` : item.open ? " · open board" : ""}{item.claimer ? ` · claimed by ${item.claimer.name}` : ""}</div>
              {item.reason && <div className="m">{item.reason}</div>}
              <Violations items={item.review?.violations ?? []} />
            </li>
          ))}
        </ul>
      </div>
      {detail && (
        <div className="panel" style={{ marginTop: 16 }} data-testid="shift-swap-history">
          <h3>{detail.requester.name} · {detail.status}</h3>
          <Violations items={detail.review?.violations ?? []} />
          {(detail.review?.hours ?? []).some(row => row.lieuAfter !== row.lieuBefore) && (
            <p className="m">Lieu hours change with this rota. The 40-hour week is the house standard unless settings say otherwise.</p>
          )}
          <ol>
            {detail.events.map((event, i) => (
              <li key={i}>
                {event.to_status} · {event.action}{event.by_name ? ` · ${event.by_name}` : ""}{event.note ? ` · ${event.note}` : ""}
                {(event.payload?.hours ?? []).filter(row => row.lieuAfter !== row.lieuBefore).map(row => (
                  <div className="m" key={row.userId}>Weekly hours {row.weeklyBefore} to {row.weeklyAfter}. Lieu {row.lieuBefore} to {row.lieuAfter}.</div>
                ))}
              </li>
            ))}
          </ol>
          {detail.assignments.length > 0 && (
            <p className="m">{detail.assignments.length} rota assignment{detail.assignments.length === 1 ? "" : "s"} recorded.</p>
          )}
          {(detail.status === "pending" || detail.status === "accepted") && (
            <div className="swap-form">
              <label>Decision note
                <input data-testid="shift-swap-note" value={note} onChange={e => setNote(e.target.value)} />
              </label>
              <button className="btn primary" type="button" data-testid="shift-swap-approve" disabled={detail.review?.ok === false} onClick={() => decide("approve")}>Approve</button>
              <button className="btn" type="button" data-testid="shift-swap-reject" onClick={() => decide("reject")}>Reject</button>
            </div>
          )}
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }} data-testid="shift-swap-rules">
        <h3>Who can cover what</h3>
        <p className="m">Chefs are not given kitchen porter shifts, and kitchen porters are not given chef shifts, unless a skill says otherwise. Caps, earliest starts, and unavailable dates are per person. Real names stay in this house record, not in the public code.</p>
        <table className="rpt">
          <thead><tr><th>Person</th><th>Earliest</th><th>Weekly cap</th><th>Monthly cap</th><th>Unavailable</th><th>Skills</th><th></th></tr></thead>
          <tbody>
            {rules.map(rule => {
              const draft = ruleOf(rule);
              const set = (patch: Partial<Rule>) => setDrafts(s => ({ ...s, [rule.user_id]: { ...draft, ...patch } }));
              return (
                <tr key={rule.user_id}>
                  <td>{rule.name}<div className="m">{rule.role}{rule.cleared ? "" : " · not cleared"}</div></td>
                  <td><input aria-label={`Earliest start ${rule.name}`} value={draft.earliest_start ?? ""} onChange={e => set({ earliest_start: e.target.value || null })} style={{ width: 88 }} /></td>
                  <td><input aria-label={`Weekly cap ${rule.name}`} type="number" value={draft.weekly_hours_cap ?? ""} onChange={e => set({ weekly_hours_cap: e.target.value ? Number(e.target.value) : null })} style={{ width: 80 }} /></td>
                  <td><input aria-label={`Monthly cap ${rule.name}`} type="number" value={draft.monthly_hours_cap ?? ""} onChange={e => set({ monthly_hours_cap: e.target.value ? Number(e.target.value) : null })} style={{ width: 80 }} /></td>
                  <td><input aria-label={`Unavailable ${rule.name}`} value={draft.unavailable.join(", ")} onChange={e => set({ unavailable: e.target.value.split(",").map(v => v.trim()).filter(Boolean) })} /></td>
                  <td><input aria-label={`Skills ${rule.name}`} value={draft.skills.join(", ")} onChange={e => set({ skills: e.target.value.split(",").map(v => v.trim()).filter(Boolean) })} /></td>
                  <td><button className="btn" type="button" onClick={() => saveRule(rule)}>Save</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
