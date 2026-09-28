"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Settings = {
  sequences: { pre_arrival: boolean; see_you_tomorrow: boolean; check_in: boolean; post_stay: boolean; rebook: boolean };
  pre_arrival_days: number;
  check_in_time: string;
  rebook_days: number;
  id_required: boolean;
  emergency_retention_days: number;
  house_rules: string;
  what_to_bring: string;
  directions: string;
  key_instructions: string;
  templates: Record<string, { subject: string; body: string }>;
  merge_fields?: string[];
  kinds?: string[];
};

type Send = { id: string; group_name: string; kind: string; channel: string; to_email: string; status: string; sent_at: string };

const KINDS = ["pre_arrival", "see_you_tomorrow", "organiser_pre_arrival", "organiser_tomorrow", "thank_you", "rebook"];

export default function JourneyAdmin() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [kind, setKind] = useState("pre_arrival");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [sends, setSends] = useState<Send[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const next = await api<Settings>("/v1/guest-journey/settings");
    setSettings(next);
    const template = next.templates?.[kind];
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setSends((await api<{ items: Send[] }>("/v1/guest-journey/sends")).items);
  };

  useEffect(() => { load().catch(e => setErr((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (next: string) => {
    setKind(next);
    const template = settings?.templates?.[next];
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setPreview(null);
  };

  if (!settings) return <p>{err ?? "Loading the guest journey…"}</p>;

  const save = async () => {
    setErr(null);
    const templates = { ...settings.templates, [kind]: { subject: subject.trim(), body: body.trim() } };
    const next = await api<Settings>("/v1/guest-journey/settings", { method: "PUT", body: JSON.stringify({ ...settings, templates }) });
    setSettings(next);
    setMsg("Saved");
  };

  return (
    <>
      <div className="topbar"><div><h1>Guest journey</h1><p>Service messages go with the stay. A rebook note needs marketing consent.</p></div></div>
      {err && <div className="note" role="alert">{err}</div>}
      {msg && <p className="m">{msg}</p>}
      <div className="panel" data-testid="journey-settings">
        <h2>Sequences</h2>
        {([
          ["pre_arrival", "Pre-arrival"],
          ["see_you_tomorrow", "See you tomorrow"],
          ["check_in", "Digital check-in"],
          ["post_stay", "Thank-you, with the feedback form"],
          ["rebook", "Come back, marketing only"],
        ] as const).map(([key, label]) => (
          <label key={key} className="assign-check">
            <input type="checkbox" checked={settings.sequences[key]} onChange={e => setSettings({ ...settings, sequences: { ...settings.sequences, [key]: e.target.checked } })} />
            {label}
          </label>
        ))}
        <p className="m">Digital check-in is off until you tick it.</p>
        <label>Days before arrival<input type="number" min={1} max={30} aria-label="Pre-arrival days" value={settings.pre_arrival_days} onChange={e => setSettings({ ...settings, pre_arrival_days: Number(e.target.value) })} /></label>
        <label>Check-in opens<input aria-label="Check-in time" value={settings.check_in_time} onChange={e => setSettings({ ...settings, check_in_time: e.target.value })} /></label>
        <label>Rebook delay, days after departure<input type="number" min={1} max={365} aria-label="Rebook days" value={settings.rebook_days} onChange={e => setSettings({ ...settings, rebook_days: Number(e.target.value) })} /></label>
        <label className="assign-check"><input type="checkbox" checked={settings.id_required} onChange={e => setSettings({ ...settings, id_required: e.target.checked })} /> Ask for identification</label>
        <label>Emergency contact, days kept after departure<input type="number" min={1} aria-label="Emergency retention" value={settings.emergency_retention_days} onChange={e => setSettings({ ...settings, emergency_retention_days: Number(e.target.value) })} /></label>
        <label>House notes<textarea aria-label="House rules" rows={5} value={settings.house_rules} onChange={e => setSettings({ ...settings, house_rules: e.target.value })} /></label>
        <label>What to bring<textarea aria-label="What to bring" rows={3} value={settings.what_to_bring} onChange={e => setSettings({ ...settings, what_to_bring: e.target.value })} /></label>
        <label>Directions<textarea aria-label="Directions" rows={3} value={settings.directions} onChange={e => setSettings({ ...settings, directions: e.target.value })} /></label>
        <label>Key collection<textarea aria-label="Key instructions" rows={2} value={settings.key_instructions} onChange={e => setSettings({ ...settings, key_instructions: e.target.value })} /></label>
      </div>
      <div className="panel" style={{ marginTop: 14 }} data-testid="journey-template">
        <h2>Message</h2>
        <label>Which letter
          <select aria-label="Message kind" value={kind} onChange={e => choose(e.target.value)}>
            {KINDS.map(item => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <p className="m">Merge fields: {(settings.merge_fields ?? []).map(field => `{{${field}}}`).join(" ")}</p>
        <label>Subject<input aria-label="Template subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Leave blank to keep the house wording" /></label>
        <label>Body<textarea aria-label="Template body" rows={10} value={body} onChange={e => setBody(e.target.value)} placeholder="Leave blank to keep the house wording" /></label>
        <div className="actions">
          <button className="btn" type="button" onClick={async () => {
            setPreview(await api("/v1/guest-journey/preview", { method: "POST", body: JSON.stringify({ kind, subject, body }) }));
          }}>Preview</button>
          <button className="btn primary" type="button" onClick={() => save().catch(e => setErr((e as Error).message))}>Save</button>
        </div>
        {preview && (
          <div data-testid="journey-preview">
            <h3>{preview.subject}</h3>
            <pre style={{ whiteSpace: "pre-wrap" }}>{preview.body}</pre>
          </div>
        )}
      </div>
      <div className="panel" style={{ marginTop: 14 }} data-testid="journey-log">
        <h2>Send log</h2>
        {sends.length === 0 && <p className="m">Nothing sent yet.</p>}
        <ul>
          {sends.map(row => (
            <li key={row.id}>{row.group_name} · {row.kind.replace(/_/g, " ")} · {row.channel} · {row.to_email} · {row.status}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
