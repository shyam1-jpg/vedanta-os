"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";

const COVER: Record<string, { priority: string; protect: string; handover: string; route: string; action: string }> = {
  HOUSE: { priority: "Name the duty lead and check the whole-house gaps", protect: "Arrivals, guest safety, meals and an open front door", handover: "Record who owns each gap, the next check time and any service change", route: "/ops/", action: "Open house log" },
  FRONT: { priority: "Duty lead assigns a reception-trained colleague", protect: "Arrivals, keys, guest calls and the welcome desk", handover: "Pass on late arrivals, guest requests and stock still needed", route: "/front/", action: "Open front desk" },
  NIGHT: { priority: "Duty lead arranges competent overnight cover before day staff leave", protect: "Front door, fire exits, late arrivals and emergency response", handover: "Confirm the cover has keys, contact details and the night round", route: "/night/", action: "Open night board" },
  HK: { priority: "Supervisor reallocates rooms by arrival time", protect: "Departure rooms and inspected rooms for today's arrivals", handover: "Flag rooms that cannot be ready and tell front desk early", route: "/housekeeping/", action: "Open room work" },
  KITCHEN: { priority: "Head chef or duty lead resets the production plan", protect: "Safe food, verified allergens and the next meal service", handover: "Assign the pass and each section; log any reduced offer with restaurant", route: "/kitchen/", action: "Open kitchen" },
  RESTAURANT: { priority: "Restaurant lead reassigns service stations", protect: "Allergen handoff, covers and clear communication with the pass", handover: "Tell kitchen and duty lead if service timing or capacity changes", route: "/ops/", action: "Open house log" },
  MAINT: { priority: "Duty lead triages and isolates unsafe equipment or areas", protect: "Fire, water, power, heating and guest access", handover: "Log the fault, owner, temporary measure and next update", route: "/maintenance/", action: "Open maintenance" },
  GROUNDS: { priority: "Duty lead makes unsafe paths and outdoor areas inaccessible", protect: "Guest routes, access and weather-related hazards", handover: "Log the location, temporary barrier, owner and follow-up", route: "/ops/", action: "Open house log" },
};

type Step = { title: string; look: string; act: string; note?: string };
type Node = { title: string; caption: string };
type Chapter = {
  id: string; slug: string; department: string; department_label: string;
  kind: string; kind_label: string; title: string; summary: string; body: string;
  steps: Step[]; diagram: Node[]; status: string; sort_order: number;
};
type List = { items: Chapter[]; can_edit: boolean };

function slugFromSearch() {
  if (typeof window === "undefined") return "app-how-to-use";
  return new URLSearchParams(window.location.search).get("slug") || "app-how-to-use";
}

export default function HouseManual() {
  const { can } = useStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [list, setList] = useState<List | null>(null);
  const [slug, setSlug] = useState(slugFromSearch);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({ title: "", summary: "", body: "" });
  const [toast, setToast] = useState<string | null>(null);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [view, setView] = useState<"standard" | "absence">("standard");
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3200); };
  const load = () => {
    setLoadError(null);
    return api<List>(`/v1/manuals${showWithdrawn ? "?include=withdrawn" : ""}`).then(setList).catch(e => setLoadError(e instanceof ApiError ? e.problem.detail : "Could not reach the manual. Try again."));
  };
  useEffect(() => { setSlug(slugFromSearch()); }, []);
  useEffect(() => { load(); }, [showWithdrawn]); // eslint-disable-line
  const items = list?.items ?? [];
  const chapter = items.find(c => c.slug === slug) ?? items[0];
  const groups = useMemo(() => {
    const map = new Map<string, Chapter[]>();
    for (const c of items) {
      const key = c.department_label;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [items]);

  useEffect(() => {
    if (chapter) setDraft({ title: chapter.title, summary: chapter.summary, body: chapter.body });
  }, [chapter?.slug]); // eslint-disable-line

  const open = (s: string) => {
    setSlug(s);
    setEdit(false);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/manual/?slug=${s}`);
  };

  if (!list && loadError) return <div className="empty" role="alert"><p>{loadError}</p><button className="btn" onClick={() => { load(); }}>Try again</button><a className="btn" href={"/sign-in/?next=" + encodeURIComponent("/manual/?slug=" + slug)}>Sign in again</a></div>;
  if (!list) return <div className="empty">Opening the house manual…</div>;
  if (!chapter) return <div className="empty">No chapters yet.</div>;

  return (
    <>
      {loadError && <div className="note" role="alert">{loadError} <button className="btn" onClick={() => { load(); }}>Try again</button></div>}
      <div className="topbar">
        <div>
          <h1>House manual</h1>
          <p>What it should look like, and how to act — for every department. Heads of department can change a chapter later, send it to the Pocket, or withdraw it from the floor.</p>
        </div>
        {list.can_edit && (
          <label className="m" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={showWithdrawn} onChange={e => setShowWithdrawn(e.target.checked)} /> Show withdrawn
          </label>
        )}
      </div>

      <section className="house-panel" aria-label="Connected operations" style={{ marginBottom: 24, background: "var(--forest)", color: "var(--paper)", padding: 28 }}>
        <div className="k" style={{ color: "inherit" }}>VEDANTA OPERATIONS</div>
        <h2 style={{ color: "inherit" }}>The whole retreat, connected</h2>
        <p>Use the live workspaces below. Managers review department plans, owners and deadlines before creating work. Staff record progress, evidence and handovers.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          {can("task.read") && <a className="btn" href="/tasks/">Task command centre →</a>}
          {can("group.read") && <a className="btn" href="/readiness/">Retreat readiness →</a>}
          {can("group.read") && <a className="btn" href="/pre-retreat/">Pre-retreat readiness →</a>}
          {can("guest.read") && <a className="btn" href="/guest-changes/">Guest update review →</a>}
          {can("maintenance.read") && <a className="btn" href="/assets/">Equipment and QR labels →</a>}
        </div>
        <p style={{ marginTop: 18, fontSize: 13 }}>Sign in using Microsoft or an enabled email-code option. Access follows your role. These workspaces are part of the app; the saved manual chapters below are maintained separately.</p>
      </section>

      <div className="manual-map">
        {groups.map(([label, chs]) => (
          <button key={label} className={"manual-dept" + (chs.some(c => c.slug === chapter.slug) ? " on" : "")} onClick={() => open(chs[0].slug)}>
            <b>{label}</b>
            <span>{chs.length} {chs.length === 1 ? "chapter" : "chapters"}</span>
          </button>
        ))}
      </div>

      <div className="house-grid manual-layout">
        <aside className="house-panel">
          <div className="k">Contents</div>
          <h2>Chapters</h2>
          {groups.map(([label, chs]) => (
            <div key={label} className="manual-toc">
              <div className="manual-toc-h">{label}</div>
              {chs.map(c => (
                <button key={c.slug} className={c.slug === chapter.slug ? "on" : ""} onClick={() => open(c.slug)}>
                  {c.title}
                  {c.status === "withdrawn" && <span className="chip">Withdrawn</span>}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <article className="house-panel">
          <div className="k">{chapter.department_label} · {chapter.kind_label}</div>
          <h2>{chapter.title}</h2>
          {chapter.status === "withdrawn" && <p className="note">This chapter is withdrawn. The floor no longer sees it. Receipts already sent stay on the Pocket.</p>}

          <div className="manual-switch" role="group" aria-label="Manual view">
            <button type="button" className={view === "standard" ? "on" : ""} aria-pressed={view === "standard"} onClick={() => setView("standard")}>Standard procedure</button>
            <button type="button" className={view === "absence" ? "on" : ""} aria-pressed={view === "absence"} onClick={() => setView("absence")}>If someone is absent</button>
          </div>

          {view === "absence" && (() => {
            const cover = COVER[chapter.department] ?? COVER.HOUSE;
            return <section className="cover-guide" aria-label={`${chapter.department_label} absence cover`}>
              <div className="cover-intro"><span className="k">SERVICE CONTINUITY</span><h3>{chapter.department_label}: cover the essentials</h3><p>The duty lead confirms who is present and assigns a competent person. Record the decision before the next service point.</p></div>
              <div className="cover-path">
                <div><span className="cover-number">01</span><strong>Confirm the gap</strong><p>Check the rota and contact the missing colleague. Tell the duty lead and the department lead.</p></div>
                <div><span className="cover-number">02</span><strong>Protect the service</strong><p>{cover.priority}. {cover.protect} take priority.</p></div>
                <div><span className="cover-number">03</span><strong>Assign and hand over</strong><p>{cover.handover}. Do not assign restricted or safety-critical work to an untrained person.</p></div>
                <div><span className="cover-number">04</span><strong>Review and escalate</strong><p>Check progress at the next service point. If safe cover cannot be arranged, the duty lead changes the service and informs affected teams.</p></div>
              </div>
              <div className="cover-actions"><a className="btn primary" href={cover.route}>{cover.action}</a><a className="btn" href="/hr/">Check rota and people</a><a className="btn" href="/tasks/">Assign a task</a></div>
              <p className="cover-caution">This is the cover decision guide. Follow the current chapter below for the actual work; emergency and safety procedures still apply.</p>
            </section>;
          })()}

          {view === "standard" && chapter.diagram.length > 0 && (
            <div className="manual-flow" aria-label="How this work moves">
              {chapter.diagram.map((n, i) => (
                <span key={n.title} className="manual-step">
                  {i > 0 && <span className="manual-arrow" aria-hidden>→</span>}
                  <span className="manual-node">
                    <strong>{n.title}</strong>
                    <em>{n.caption}</em>
                  </span>
                </span>
              ))}
            </div>
          )}

          {!edit && view === "standard" && (
            <>
              <section className="look-act">
                <div>
                  <div className="k">What it should look like</div>
                  <p>{chapter.summary}</p>
                </div>
                <div>
                  <div className="k">How to act</div>
                  <p style={{ whiteSpace: "pre-wrap" }}>{chapter.body}</p>
                </div>
              </section>
              <div className="k" style={{ marginTop: 22 }}>The steps</div>
              {chapter.steps.map((s, i) => (
                <div key={s.title} className="look-step">
                  <header><span>{i + 1}</span><h3>{s.title}</h3></header>
                  <div className="look-act tight">
                    <div><div className="k">Look</div><p>{s.look}</p></div>
                    <div><div className="k">Act</div><p>{s.act}</p></div>
                  </div>
                  {s.note && <p className="m">{s.note}</p>}
                </div>
              ))}
            </>
          )}

          {edit && list.can_edit && view === "standard" && (
            <form className="ops-form" onSubmit={async e => {
              e.preventDefault();
              try {
                await api(`/v1/manuals/${chapter.slug}`, { method: "PATCH", body: JSON.stringify(draft) });
                say("Chapter saved — the house now teaches this wording");
                setEdit(false);
                load();
              } catch (err) { say(err instanceof ApiError ? err.problem.detail : "Could not save"); }
            }}>
              <label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
              <label>What it should look like<textarea rows={5} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
              <label>How to act<textarea rows={10} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
              <p className="m">Steps and the diagram stay as they are unless a developer changes the default chapter. Words above are yours.</p>
              <div className="actions" style={{ border: 0 }}>
                <button className="btn" type="button" onClick={() => setEdit(false)}>Cancel</button>
                <button className="btn primary" type="submit">Save the chapter</button>
              </div>
            </form>
          )}

          {list.can_edit && !edit && view === "standard" && (
            <div className="actions" style={{ border: 0, paddingTop: 18 }}>
              <button className="btn" onClick={() => setEdit(true)}>Change the wording</button>
              <button className="btn" onClick={async () => {
                try {
                  const r = await api<{ sent: number }>(`/v1/manuals/${chapter.slug}/send`, { method: "POST", body: "{}" });
                  say(`Sent to ${r.sent} people on the Pocket — they mark it received`);
                } catch (err) { say(err instanceof ApiError ? err.problem.detail : "Could not send"); }
              }}>Send to the Pocket</button>
              <button className="btn" onClick={async () => {
                const next = chapter.status === "withdrawn" ? "live" : "withdrawn";
                try {
                  await api(`/v1/manuals/${chapter.slug}/withdraw`, { method: "POST", body: JSON.stringify({ status: next }) });
                  say(next === "withdrawn" ? "Withdrawn from the floor" : "Restored to the floor");
                  load();
                } catch (err) { say(err instanceof ApiError ? err.problem.detail : "Could not change"); }
              }}>{chapter.status === "withdrawn" ? "Restore" : "Withdraw"}</button>
            </div>
          )}
        </article>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
