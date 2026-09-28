"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Tone = "red" | "amber" | "green";
type Line = { key: string; text: string; href: string };
type Section = { key: string; title: string; tone: Tone; summary: string; href: string; lines: Line[] };
type Watch = { key: string; rule: string; points: number; why: string; title: string; href: string; pinned: boolean };
type Board = {
  date: string;
  generatedAt: string;
  cached: boolean;
  view: string;
  home: "house" | "briefing";
  canManage: boolean;
  watch: Watch[];
  held: Watch[];
  sections: Section[];
};

const STORE = "vedanta.briefing";

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function readStore(): Board | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? JSON.parse(raw) as Board : null;
  } catch { return null; }
}

export default function Briefing() {
  const [board, setBoard] = useState<Board | null>(null);
  const [stale, setStale] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Board>("/v1/briefing");
      setBoard(next);
      setStale(false);
      setErr(null);
      sessionStorage.setItem(STORE, JSON.stringify(next));
    } catch (e) {
      const saved = readStore();
      if (saved) { setBoard(saved); setStale(true); }
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const saved = readStore();
    if (saved) setBoard(saved);
    void load();
    const timer = window.setInterval(() => { void load(); }, 60_000);
    const onNet = () => { if (navigator.onLine) void load(); else setStale(true); };
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
    };
  }, [load]);

  const mark = async (key: string, action: "pin" | "dismiss" | "clear") => {
    try {
      await api("/v1/briefing/pins", { method: "POST", body: JSON.stringify({ key, action }) });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const home = async (next: "house" | "briefing") => {
    try {
      await api("/v1/me/home", { method: "PUT", body: JSON.stringify({ home: next }) });
      setBoard(current => current ? { ...current, home: next } : current);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Morning briefing</h1>
          <p>{board ? board.date : "Today"} · before service</p>
        </div>
      </div>
      <p className="m" data-testid="briefing-stale">
        {stale ? "Offline · last updated " : "Updated "}{board ? clock(board.generatedAt) : "—"}
        {board?.cached ? " · cached" : ""}
      </p>
      <div className="audit-actions">
        <button className="btn" type="button" data-testid="briefing-refresh" onClick={() => void load()}>Refresh</button>
        <label className="m" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            data-testid="briefing-home"
            checked={board?.home === "briefing"}
            onChange={e => void home(e.target.checked ? "briefing" : "house")}
          />
          Open this after I sign in
        </label>
      </div>
      {err && <div className="note">{err}</div>}
      <div className="briefing-watch" data-testid="briefing-watch">
        {(board?.watch ?? []).length === 0 && <div className="briefing-card"><b>Top 3 to watch</b><p className="m">Nothing needs a watch this morning.</p></div>}
        {(board?.watch ?? []).map(item => (
          <article className="briefing-card" key={item.key}>
            <a href={item.href}><b>{item.title}</b></a>
            <p className="m" data-testid="briefing-why">{item.why}</p>
            {board?.canManage && (
              <div className="briefing-actions">
                <button className="btn" type="button" data-testid="briefing-pin" onClick={() => void mark(item.key, item.pinned ? "clear" : "pin")}>{item.pinned ? "Unpin" : "Pin"}</button>
                <button className="btn ghost" type="button" data-testid="briefing-dismiss" onClick={() => void mark(item.key, "dismiss")}>Dismiss</button>
              </div>
            )}
          </article>
        ))}
      </div>
      {board?.canManage && (board.held ?? []).length > 0 && (
        <section className="panel" data-testid="briefing-held">
          <h3>Also scored</h3>
          <p className="m">Pin one to keep it in the top three today.</p>
          {board.held.map(item => (
            <div key={item.key}>
              <a href={item.href}><b>{item.title}</b></a>
              <p className="m" data-testid="briefing-why">{item.why}</p>
              <div className="briefing-actions">
                <button className="btn" type="button" data-testid="briefing-pin" onClick={() => void mark(item.key, item.pinned ? "clear" : "pin")}>{item.pinned ? "Unpin" : "Pin"}</button>
                <button className="btn ghost" type="button" data-testid="briefing-dismiss" onClick={() => void mark(item.key, "dismiss")}>Dismiss</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {(board?.sections ?? []).map(section => (
        <section className="panel briefing-section" key={section.key} data-testid="briefing-section" data-tone={section.tone}>
          <h3><i className={`audit-dot ${section.tone}`} aria-hidden="true" /> {section.title}</h3>
          <p className="m">{section.summary}</p>
          {section.lines.map(item => (
            <a className="briefing-line" key={item.key} href={item.href}>{item.text}</a>
          ))}
        </section>
      ))}
    </>
  );
}
