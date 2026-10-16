"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { API, api, ApiError, token } from "@/lib/api";
import { kitStamp, useKitBus } from "@/components/OpsChrome";

type Chapter = { id: string; parent_id: string | null; title: string; sort_order: number };
type Article = { id: string; chapter_id: string; title: string; keywords: string[]; audience: string[]; review_on: string | null; status: string; version: number; created_at?: string; updated_at?: string; editor?: string; attachment_count?: number; signed: boolean; signed_count: number };
type Version = { version: number; title: string; body_html?: string; edited_at: string; note: string; editor?: string };
type Detail = Article & { body_html: string; editor?: string; created_at?: string; updated_at?: string; versions: Version[]; attachments: { id: string; kind: string; filename: string; url: string | null }[]; signers: { name: string; signed_at: string }[]; can_publish: boolean };
const DEPTS = ["ALL", "HOUSE", "FRONT", "NIGHT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];

async function saveFile(path: string, name: string) {
  const res = await fetch(API + path, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
  if (!res.ok) throw new Error("Could not download");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Rich({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.innerHTML = value; }, [value]);
  const mark = (command: string) => { ref.current?.focus(); document.execCommand(command); onChange(ref.current?.innerHTML ?? ""); };
  return (
    <div>
      <div className="kit-seg" style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => mark("bold")}>Bold</button>
        <button type="button" onClick={() => mark("italic")}>Italic</button>
        <button type="button" onClick={() => mark("insertUnorderedList")}>List</button>
        <button type="button" onClick={() => { ref.current?.focus(); document.execCommand("formatBlock", false, "h2"); onChange(ref.current?.innerHTML ?? ""); }}>Heading</button>
      </div>
      <div className="rich" contentEditable role="textbox" aria-label="Article text" ref={ref} onInput={() => onChange(ref.current?.innerHTML ?? "")} />
    </div>
  );
}

export default function Handbook() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"az" | "za">("az");
  const [filtersOn, setFiltersOn] = useState(false);
  const [signedFilter, setSignedFilter] = useState<"all" | "signed" | "open">("all");
  const [adding, setAdding] = useState(false);
  const [compare, setCompare] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [reminder, setReminder] = useState("");
  const [remindOn, setRemindOn] = useState(false);
  const [draft, setDraft] = useState({ chapter_id: "", title: "", body_html: "", keywords: "", audience: "ALL", review_on: "" });

  const load = () => api<{ chapters: Chapter[]; articles: Article[]; can_publish: boolean }>("/v1/handbook").then(r => { setChapters(r.chapters); setArticles(r.articles); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the handbook"));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    api<Detail>(`/v1/handbook/articles/${sel}`).then(setDetail).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the article"));
  }, [sel]);
  useEffect(() => {
    setCompare(false); setRemindOn(false);
    if (!sel) return;
    setBookmarked(localStorage.getItem("vedanta.bookmark." + sel) === "1");
    setReminder(localStorage.getItem("vedanta.reminder." + sel) ?? "");
  }, [sel]);
  useKitBus({ onAdd: () => { if (!canPublish) return false; setAdding(true); }, onSearch: setQ });

  const publish = canPublish;
  const chapter = chapters.find(c => c.id === (detail?.chapter_id ?? chapterId)) ?? null;
  const rows = articles
    .filter(a => (!chapterId || a.chapter_id === chapterId) && (signedFilter === "all" || (signedFilter === "signed" ? a.signed : !a.signed)) && `${a.title} ${a.keywords.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title) * (order === "az" ? 1 : -1));
  const previous = detail?.versions.find(v => v.version === detail.version - 1) ?? detail?.versions[1];

  return (
    <div className="kit-page">
      <div className="kit-pagehead">
        <h1>Handbook</h1>
        <div className="kit-pagehead-actions">
          {publish && <button type="button" className="kit-add" onClick={() => setAdding(v => !v)}>{adding ? "Close" : "Add article"}</button>}
          <button type="button" className="kit-outline" onClick={() => setOrder(o => o === "az" ? "za" : "az")}><span className="material-icons">sort_by_alpha</span>Order: alphabetically {order === "az" ? "A-Z" : "Z-A"}</button>
          <button type="button" className="kit-outline" onClick={() => setFiltersOn(v => !v)}><span className="material-icons">filter_list</span>Filters</button>
        </div>
      </div>
      {!publish && <p className="m">You can read articles and confirm you have read them. Publishing is for the owner and the general manager.</p>}
      {filtersOn && (
        <div className="kit-filters">
          {(["all", "open", "signed"] as const).map(id => <button type="button" key={id} className={signedFilter === id ? "on" : ""} onClick={() => setSignedFilter(id)}>{id === "all" ? "All" : id === "open" ? "To read" : "Signed"}</button>)}
        </div>
      )}
      {err && <div className="note">{err}</div>}
      <div className="kit-crumb">
        <button type="button" onClick={() => { setSel(null); setChapterId(null); }}>The Vedanta</button>
        {" » "}
        {detail ? <button type="button" onClick={() => setSel(null)}>{chapter?.title ?? "Handbook"}</button> : (chapter?.title ?? "Handbook")}
        {detail ? ` » ${detail.title}` : ""}
      </div>
      {!detail && (
        <div className="kit-sheet">
          {!chapterId && chapters.map(ch => (
            <button type="button" key={ch.id} className="kit-row" onClick={() => setChapterId(ch.id)}>
              <span className="material-icons">folder</span>
              <strong>{ch.title}</strong>
              <span className="m">{articles.filter(a => a.chapter_id === ch.id).length} articles</span>
            </button>
          ))}
          {(chapterId || q) && rows.map(a => (
            <button type="button" key={a.id} className="kit-row" onClick={() => setSel(a.id)}>
              <span className="material-icons">description</span>
              <strong>{a.title}</strong>
              <span className="kit-row-side">
                <span className="m">{a.editor ?? "House"}, {kitStamp(a.updated_at)}</span>
                {(a.attachment_count ?? 0) > 0 && <span className="material-icons kit-clip" title="Attachment">attach_file</span>}
                <em>Version {a.version}</em>
              </span>
            </button>
          ))}
          {((chapterId || q) ? rows.length === 0 : chapters.length === 0) && <p className="kit-empty">{q ? "Nothing matches this search." : "The handbook is empty until an admin publishes a chapter."}</p>}
        </div>
      )}
      {detail && (
        <article className="kit-card kit-entry print-sheet">
          <h1>{detail.title}</h1>
          <p className="m">Created: {detail.editor ?? "House"}, {kitStamp(detail.created_at)} · Last change: {detail.editor ?? "House"}, {kitStamp(detail.updated_at)} (Version {detail.version})</p>
          <div className="kit-entry-actions no-print">
            <button type="button" className="kit-outline" disabled={!previous} onClick={() => setCompare(v => !v)}>Compare to previous version</button>
            <button type="button" className="kit-icon" aria-label="Bookmark" onClick={() => {
              const next = !bookmarked; setBookmarked(next);
              if (next) localStorage.setItem("vedanta.bookmark." + detail.id, "1"); else localStorage.removeItem("vedanta.bookmark." + detail.id);
            }}><span className="material-icons">{bookmarked ? "bookmark" : "bookmark_border"}</span></button>
            <button type="button" className="kit-outline" onClick={() => setRemindOn(v => !v)}><span className="material-icons">alarm</span>Reminder</button>
          </div>
          {remindOn && <label className="kit-remind no-print">Remind me<input type="date" value={reminder} onChange={e => { setReminder(e.target.value); localStorage.setItem("vedanta.reminder." + detail.id, e.target.value); }} /></label>}
          {reminder && <p className="m">Reminder set for {reminder}. Review date {detail.review_on ?? "not set"}.</p>}
          {compare && previous && (
            <div className="kit-compare">
              <div><h2>Version {previous.version}</h2><div className="kit-prose" dangerouslySetInnerHTML={{ __html: previous.body_html || `<p>${previous.note}</p>` }} /></div>
              <div><h2>Version {detail.version}</h2><div className="kit-prose" dangerouslySetInnerHTML={{ __html: detail.body_html }} /></div>
            </div>
          )}
          {!compare && <div className="kit-prose" dangerouslySetInnerHTML={{ __html: detail.body_html }} />}
          <div className="facts">
            <div><span>Keywords</span><b>{detail.keywords.join(", ") || "—"}</b></div>
            <div><span>Who can read</span><b>{detail.audience.length ? detail.audience.join(", ") : "Whole house"}</b></div>
            <div><span>Review</span><b>{detail.review_on ?? "—"}</b></div>
          </div>
          {detail.attachments.map(file => (
            <div className="attach" key={file.id}>
              <span className="material-icons">attach_file</span>
              <span>{file.kind} · {file.filename}</span>
              {file.kind === "video" && file.url
                ? <a className="kit-outline" href={file.url} target="_blank" rel="noreferrer">Open link</a>
                : <button type="button" className="kit-outline" onClick={() => saveFile(`/v1/handbook/attachments/${file.id}`, file.filename).catch(e2 => setErr((e2 as Error).message))}>Download</button>}
            </div>
          ))}
          <div className="kit-entry-actions no-print">
            <button type="button" className="kit-add" disabled={detail.signed} onClick={async () => { await api(`/v1/handbook/articles/${detail.id}/sign`, { method: "POST", body: "{}" }); const next = await api<Detail>(`/v1/handbook/articles/${detail.id}`); setDetail(next); load(); }}>I have read this</button>
            <Link className="kit-outline" href={`/handbook/print/?id=${detail.id}`}>Print</Link>
            <button type="button" className="kit-outline" onClick={() => saveFile(`/v1/handbook/articles/${detail.id}/pdf`, "handbook.pdf").catch(e2 => setErr((e2 as Error).message))}>Download PDF</button>
          </div>
          {publish && detail.signers.length > 0 && <p className="m">{detail.signers.length} signed this version: {detail.signers.map(s => s.name).join(", ")}</p>}
        </article>
      )}
      {publish && adding && (
        <div className="kit-card no-print">
          <form onSubmit={async e => {
            e.preventDefault();
            try {
              await api("/v1/handbook/chapters", { method: "POST", body: JSON.stringify({ title: chapterTitle }) });
              setChapterTitle(""); load();
            } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not add the chapter"); }
          }}>
            <h2>New chapter</h2>
            <label>Title<input value={chapterTitle} onChange={e => setChapterTitle(e.target.value)} required /></label>
            <button className="kit-outline" type="submit">Add chapter</button>
          </form>
          <form onSubmit={async e => {
            e.preventDefault();
            try {
              const created = await api<{ id: string }>("/v1/handbook/articles", { method: "POST", body: JSON.stringify({ ...draft, keywords: draft.keywords.split(",").map(s => s.trim()).filter(Boolean), audience: draft.audience === "ALL" ? [] : [draft.audience] }) });
              setSel(created.id); setChapterId(draft.chapter_id || null); load();
            } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not publish"); }
          }}>
            <h2>Add article</h2>
            <label>Chapter<select required value={draft.chapter_id} onChange={e => setDraft({ ...draft, chapter_id: e.target.value })}><option value="">Choose</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
            <label>Title<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
            <label>Keywords<input value={draft.keywords} onChange={e => setDraft({ ...draft, keywords: e.target.value })} placeholder="risk, training" /></label>
            <div className="frow">
              <label>Read rights<select value={draft.audience} onChange={e => setDraft({ ...draft, audience: e.target.value })}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></label>
              <label>Review date<input type="date" value={draft.review_on} onChange={e => setDraft({ ...draft, review_on: e.target.value })} /></label>
            </div>
            <Rich value={draft.body_html} onChange={body_html => setDraft({ ...draft, body_html })} />
            <button className="kit-add" type="submit">Publish article</button>
          </form>
          {sel && <label>Attach PDF or image<input type="file" accept="application/pdf,image/*" onChange={async e => {
            const file = e.target.files?.[0]; if (!file || !sel) return;
            const data = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file); });
            await api(`/v1/handbook/articles/${sel}/attachments`, { method: "POST", body: JSON.stringify({ kind: file.type === "application/pdf" ? "pdf" : "image", filename: file.name, data }) });
            api<Detail>(`/v1/handbook/articles/${sel}`).then(setDetail);
          }} /></label>}
          {sel && <form onSubmit={async e => { e.preventDefault(); const url = new FormData(e.currentTarget).get("url"); await api(`/v1/handbook/articles/${sel}/attachments`, { method: "POST", body: JSON.stringify({ kind: "video", url, filename: "Video" }) }); api<Detail>(`/v1/handbook/articles/${sel}`).then(setDetail); }}>
            <label>Video link<input name="url" placeholder="https://" /></label><button className="kit-outline" type="submit">Add video link</button>
          </form>}
        </div>
      )}
    </div>
  );
}
