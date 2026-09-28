"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Shift = { id: string; user_id: string; name: string; date: string; start: string; end: string; role_code: string | null; department: string };
type Person = { id: string; name: string; role: string };
type Violation = { code: string; severity: "hard" | "warn"; message: string };
type Swap = {
  id: string;
  kind: string;
  status: string;
  open: boolean;
  reason: string;
  requester: { id: string; name: string | null };
  partner: { id: string; name: string | null } | null;
  claimer: { id: string; name: string | null } | null;
  shift: Shift | null;
  partner_shift: Shift | null;
  review: { ok: boolean; violations: Violation[] } | null;
};
type BoardItem = Swap & { warnings: Violation[] };
type Mine = {
  can_manage: boolean;
  shifts: Shift[];
  colleague_shifts: Shift[];
  colleagues: Person[];
  requests: Swap[];
  incoming: Swap[];
  board: BoardItem[];
};

const KINDS = [
  { id: "swap", label: "Swap with someone's shift" },
  { id: "cover", label: "Give away or ask for cover" },
  { id: "day_off", label: "Day off" },
];

function when(slot: { date: string; start: string; end: string } | null) {
  if (!slot) return "Shift no longer on the rota";
  return `${slot.date} ${slot.start}–${slot.end}`;
}

function Violations({ items }: { items: Violation[] }) {
  if (!items.length) return null;
  return (
    <ul data-testid="shift-swap-violations">
      {items.map((item, i) => (
        <li key={i} className={item.severity === "hard" ? "swap-hard" : "swap-warn"}>
          {item.severity === "hard" ? "Blocked" : "Warning"}: {item.message}
        </li>
      ))}
    </ul>
  );
}

export default function ShiftSwapPocket({ canManage, onError }: { canManage: boolean; onError: (msg: string | null) => void }) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [shiftId, setShiftId] = useState("");
  const [kind, setKind] = useState("cover");
  const [partnerId, setPartnerId] = useState("");
  const [partnerShiftId, setPartnerShiftId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Violation[]>([]);
  const [busy, setBusy] = useState(false);
  const [staffShift, setStaffShift] = useState("");
  const [staffPartner, setStaffPartner] = useState("");
  const [staffPartnerShift, setStaffPartnerShift] = useState("");
  const [staffKind, setStaffKind] = useState("cover");
  const [staffReason, setStaffReason] = useState("");
  const [approveNow, setApproveNow] = useState(false);

  const load = async () => {
    const next = await api<Mine>("/v1/shift-swaps/mine");
    setMine(next);
    return next;
  };

  useEffect(() => {
    load().catch(e => onError((e as Error).message));
  }, []);

  const partnerShifts = (mine?.colleague_shifts ?? []).filter(slot => slot.user_id === partnerId);
  const managedShifts = mine?.colleague_shifts ?? [];
  const managedPartnerShifts = managedShifts.filter(slot => slot.user_id === staffPartner);

  const check = async () => {
    if (!shiftId) { setPreview([]); return; }
    const result = await api<{ ok: boolean; violations: Violation[] }>("/v1/shift-swaps/check", {
      method: "POST",
      body: JSON.stringify({ kind, shift_id: shiftId, partner_id: partnerId || null, partner_shift_id: kind === "swap" ? partnerShiftId || null : null, reason }),
    });
    setPreview(result.violations ?? []);
    return result;
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await check();
      if (result && result.violations.some(item => item.severity === "hard")) {
        onError("This request is blocked by a rota rule.");
        return;
      }
      await api("/v1/shift-swaps", {
        method: "POST",
        body: JSON.stringify({ kind, shift_id: shiftId, partner_id: partnerId || null, partner_shift_id: kind === "swap" ? partnerShiftId || null : null, reason }),
      });
      setReason("");
      setPreview([]);
      await load();
      onError(null);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const act = async (id: string, action: string) => {
    setBusy(true);
    try {
      await api(`/v1/shift-swaps/${id}/${action}`, { method: "POST", body: "{}" });
      await load();
      onError(null);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const reassign = async () => {
    const shift = managedShifts.find(slot => slot.id === staffShift);
    if (!shift) return;
    setBusy(true);
    try {
      await api("/v1/shift-swaps/reassign", {
        method: "POST",
        body: JSON.stringify({
          kind: staffKind,
          requester_id: shift.user_id,
          shift_id: staffShift,
          partner_id: staffPartner || null,
          partner_shift_id: staffKind === "swap" ? staffPartnerShift || null : null,
          reason: staffReason,
          approve: approveNow,
        }),
      });
      setStaffReason("");
      await load();
      onError(null);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card">
        <h2>Shift swap</h2>
        <p className="m">Pick one of your upcoming shifts. Name someone, or leave it open for eligible staff.</p>
        <label>Your shift
          <select data-testid="shift-swap-shift" value={shiftId} onChange={e => { setShiftId(e.target.value); setPreview([]); }}>
            <option value="">Choose a shift</option>
            {(mine?.shifts ?? []).map(slot => <option key={slot.id} value={slot.id}>{when(slot)} · {slot.role_code ?? slot.department}</option>)}
          </select>
        </label>
        <label>What do you need?
          <select data-testid="shift-swap-kind" value={kind} onChange={e => setKind(e.target.value)}>
            {KINDS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>Colleague, optional unless this is a two-way swap
          <select data-testid="shift-swap-partner" value={partnerId} onChange={e => { setPartnerId(e.target.value); setPartnerShiftId(""); }}>
            <option value="">Leave it open</option>
            {(mine?.colleagues ?? []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        {kind === "swap" && (
          <label>Their shift
            <select data-testid="shift-swap-partner-shift" value={partnerShiftId} onChange={e => setPartnerShiftId(e.target.value)}>
              <option value="">Choose their shift</option>
              {partnerShifts.map(slot => <option key={slot.id} value={slot.id}>{when(slot)}</option>)}
            </select>
          </label>
        )}
        <label>Reason
          <textarea data-testid="shift-swap-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <Violations items={preview} />
        <button className="btn" type="button" data-testid="shift-swap-submit" disabled={busy || !shiftId} onClick={submit}>Send request</button>
      </div>

      <div className="card" data-testid="shift-swap-incoming">
        <h2>Waiting for you</h2>
        {(mine?.incoming.length ?? 0) === 0 && <p className="m">Nothing to answer.</p>}
        {(mine?.incoming ?? []).map(item => (
          <div className="row" key={item.id} style={{ display: "block" }}>
            <b>{item.requester.name}</b>
            <div className="m">{KINDS.find(k => k.id === item.kind)?.label} · {when(item.shift)}</div>
            {item.reason && <div className="m">{item.reason}</div>}
            <Violations items={item.review?.violations ?? []} />
            <button className="btn" type="button" data-testid="shift-swap-accept" disabled={busy || item.review?.ok === false} onClick={() => act(item.id, "accept")}>Accept</button>
            <button className="btn ghost" type="button" data-testid="shift-swap-decline" disabled={busy} onClick={() => act(item.id, "decline")}>Decline</button>
          </div>
        ))}
      </div>

      <div className="card" data-testid="shift-swap-board">
        <h2>Open board</h2>
        <p className="m">Only shifts you can cover are listed.</p>
        {(mine?.board.length ?? 0) === 0 && <p className="m">Nothing you can claim.</p>}
        {(mine?.board ?? []).map(item => (
          <div className="row" key={item.id} style={{ display: "block" }}>
            <b>{item.requester.name}</b>
            <div className="m">{when(item.shift)} · {item.shift?.role_code ?? ""}</div>
            <Violations items={item.warnings} />
            <button className="btn" type="button" data-testid="shift-swap-claim" disabled={busy} onClick={() => act(item.id, "claim")}>Claim</button>
          </div>
        ))}
      </div>

      <div className="card" data-testid="shift-swap-mine">
        <h2>Your requests</h2>
        {(mine?.requests.length ?? 0) === 0 && <p className="m">None yet.</p>}
        {(mine?.requests ?? []).map(item => (
          <div className="row" key={item.id} style={{ display: "block" }}>
            <b>{item.status}</b>
            <div className="m">{when(item.shift)}{item.partner ? ` · ${item.partner.name}` : item.open ? " · open" : ""}</div>
            <Violations items={item.review?.violations ?? []} />
            {(item.status === "pending" || item.status === "accepted") && (
              <button className="btn ghost" type="button" data-testid="shift-swap-cancel" disabled={busy} onClick={() => act(item.id, "cancel")}>Cancel</button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="card" data-testid="shift-swap-reassign">
          <h2>Reassign</h2>
          <p className="m">Start a change for someone else. Approve it now, or leave it for a decision.</p>
          <label>Shift
            <select data-testid="shift-swap-reassign-shift" value={staffShift} onChange={e => setStaffShift(e.target.value)}>
              <option value="">Choose a shift</option>
              {managedShifts.map(slot => <option key={slot.id} value={slot.id}>{slot.name} · {when(slot)}</option>)}
            </select>
          </label>
          <label>Kind
            <select value={staffKind} onChange={e => setStaffKind(e.target.value)}>
              {KINDS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>New person
            <select data-testid="shift-swap-reassign-partner" value={staffPartner} onChange={e => setStaffPartner(e.target.value)}>
              <option value="">Leave it open</option>
              {(mine?.colleagues ?? []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          {staffKind === "swap" && (
            <label>Their shift
              <select value={staffPartnerShift} onChange={e => setStaffPartnerShift(e.target.value)}>
                <option value="">Choose their shift</option>
                {managedPartnerShifts.map(slot => <option key={slot.id} value={slot.id}>{when(slot)}</option>)}
              </select>
            </label>
          )}
          <label>Reason
            <textarea rows={2} value={staffReason} onChange={e => setStaffReason(e.target.value)} />
          </label>
          <label className="m"><input type="checkbox" checked={approveNow} onChange={e => setApproveNow(e.target.checked)} /> Approve now</label>
          <button className="btn" type="button" data-testid="shift-swap-reassign-send" disabled={busy || !staffShift} onClick={reassign}>Start reassignment</button>
        </div>
      )}
    </div>
  );
}
