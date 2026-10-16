"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { API, api, ApiError, token } from "@/lib/api";
import { DeskBar, EmptyState, EntryRow } from "@/components/OpsChrome";

type Chapter = { id: string; parent_id: string | null; title: string; sort_order: number };
type Article = { id: string; chapter_id: string; title: string; keywords: string[]; audience: string[]; review_on: string | null; status: string; version: number; signed: boolean; signed_count: number };
type Detail = Article & { body_html: string; versions: { version: number; title: string; edited_at: string; note: string }[]; attachments: { id: string; kind: string; filename: string; url: string | null }[]; signers: { name: string; signed_at: string }[]; can_publish: boolean };
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
      <div className="seg" style={{ marginBottom: 8 }}>
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ chapter_id: "", title: "", body_html: "", keywords: "", audience: "ALL", review_on: "" });

  const load = () => api<{ chapters: Chapter[]; articles: Article[]; can_publish: boolean }>("/v1/handbook").then(r => { setChapters(r.chapters); setArticles(r.articles); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the handbook"));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    api<Detail>(`/v1/handbook/articles/${sel}`).then(setDetail).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the article"));
  }, [sel]);

  const publish = canPublish;
  return (
    <>
      <div className="topbar">
        <div><h1>Handbook</h1><p>Chapters and articles for the house. Staff read and confirm. Only the owner or an admin publishes.</p></div>
      </div>
      {!publish && <p className="suite-banner">You can read articles and confirm you have read them. Publishing is for the owner and admins.</p>}
      {err && <div className="note">{err}</div>}
      <DeskBar query={q} onQuery={setQ} placeholder="Search articles" onAdd={publish ? () => setAdding(v => !v) : undefined} addLabel={adding ? "Close" : "Add entry"} />
      <div className="split">
        <div className="list">
          {chapters.map(ch => {
            const rows = articles.filter(a => a.chapter_id === ch.id && `${a.title} ${a.keywords.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
            if (!rows.length) return null;
            return (
            <div key={ch.id}>
              <div className="month">{ch.title}</div>
              {rows.map(a => (
                <EntryRow key={a.id} selected={sel === a.id} onClick={() => setSel(a.id)} name={ch.title} title={a.title} meta={`v${a.version}${a.review_on ? ` · review ${a.review_on}` : ""}`} badge={a.signed ? "Signed" : "To read"} tone={a.signed ? "good" : "warn"} />
              ))}
            </div>
            );
          })}
          {articles.filter(a => `${a.title} ${a.keywords.join(" ")}`.toLowerCase().includes(q.toLowerCase())).length === 0 && <EmptyState title="No articles" detail={q ? "Nothing matches this search." : "The handbook is empty until an admin publishes a chapter."} />}
          {publish && adding && (
            <form className="detail" style={{ position: "static", margin: 12 }} onSubmit={async e => {
              e.preventDefault();
              try {
                await api("/v1/handbook/chapters", { method: "POST", body: JSON.stringify({ title: chapterTitle }) });
                setChapterTitle(""); load();
              } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not add the chapter"); }
            }}>
              <h3>New chapter</h3>
              <label>Title<input value={chapterTitle} onChange={e => setChapterTitle(e.target.value)} required /></label>
              <button className="btn primary" style={{ marginTop: 8 }}>Add chapter</button>
            </form>
          )}
        </div>
        <div>
          {detail && (
            <article className="detail print-sheet">
              <header>
                <div><div className="k">Version {detail.version}</div><h2>{detail.title}</h2></div>
                <span className={"chip " + (detail.signed ? "CONFIRMED" : "PROVISIONAL")}>{detail.signed ? "You have signed" : "Not signed"}</span>
              </header>
              <div className="rich" dangerouslySetInnerHTML={{ __html: detail.body_html }} />
              <div className="facts">
                <div><span>Keywords</span><b>{detail.keywords.join(", ") || "—"}</b></div>
                <div><span>Who can read</span><b>{detail.audience.length ? detail.audience.join(", ") : "Whole house"}</b></div>
                <div><span>Review</span><b>{detail.review_on ?? "—"}</b></div>
              </div>
              {detail.attachments.map(file => (
                <div className="attach" key={file.id}>
                  <span>{file.kind} · {file.filename}</span>
                  {file.kind === "video" && file.url
                    ? <a className="btn" href={file.url} target="_blank" rel="noreferrer">Open link</a>
                    : <button className="btn" onClick={() => saveFile(`/v1/handbook/attachments/${file.id}`, file.filename).catch(e2 => setErr((e2 as Error).message))}>Download</button>}
                </div>
              ))}
              <div className="actions no-print">
                <button className="btn primary" disabled={detail.signed} onClick={async () => { await api(`/v1/handbook/articles/${detail.id}/sign`, { method: "POST", body: "{}" }); setSel(detail.id); api<Detail>(`/v1/handbook/articles/${detail.id}`).then(setDetail); load(); }}>I have read this</button>
                <Link className="btn" href={`/handbook/print/?id=${detail.id}`}>Print</Link>
                <button className="btn" onClick={() => saveFile(`/v1/handbook/articles/${detail.id}/pdf`, "handbook.pdf").catch(e2 => setErr((e2 as Error).message))}>Download PDF</button>
              </div>
              <h3 style={{ marginTop: 16 }}>History</h3>
              {detail.versions.map(v => <p className="m" key={v.version}>v{v.version} · {new Date(v.edited_at).toLocaleString("en-GB", { timeZone: "Europe/London" })} · {v.note}</p>)}
              {publish && detail.signers.length > 0 && <p className="m">{detail.signers.length} signed this version: {detail.signers.map(s => s.name).join(", ")}</p>}
            </article>
          )}
          {publish && adding && (
            <form className="detail no-print" style={{ position: "static", marginTop: 16 }} onSubmit={async e => {
              e.preventDefault();
              try {
                const created = await api<{ id: string }>("/v1/handbook/articles", { method: "POST", body: JSON.stringify({ ...draft, keywords: draft.keywords.split(",").map(s => s.trim()).filter(Boolean), audience: draft.audience === "ALL" ? [] : [draft.audience] }) });
                setSel(created.id); load();
              } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not publish"); }
            }}>
              <h3>Add entry</h3>
              <label>Chapter<select required value={draft.chapter_id} onChange={e => setDraft({ ...draft, chapter_id: e.target.value })}><option value="">Choose</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
              <label>Title<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
              <label>Keywords<input value={draft.keywords} onChange={e => setDraft({ ...draft, keywords: e.target.value })} placeholder="risk, training" /></label>
              <div className="frow">
                <label>Read rights<select value={draft.audience} onChange={e => setDraft({ ...draft, audience: e.target.value })}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></label>
                <label>Review date<input type="date" value={draft.review_on} onChange={e => setDraft({ ...draft, review_on: e.target.value })} /></label>
              </div>
              <Rich value={draft.body_html} onChange={body_html => setDraft({ ...draft, body_html })} />
              <button className="btn primary" style={{ marginTop: 8 }}>Publish article</button>
              {sel && <label style={{ marginTop: 12 }}>Attach PDF, image or video link<input type="file" accept="application/pdf,image/*" onChange={async e => {
                const file = e.target.files?.[0]; if (!file || !sel) return;
                const data = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file); });
                await api(`/v1/handbook/articles/${sel}/attachments`, { method: "POST", body: JSON.stringify({ kind: file.type === "application/pdf" ? "pdf" : "image", filename: file.name, data }) });
                api<Detail>(`/v1/handbook/articles/${sel}`).then(setDetail);
              }} /></label>}
              {sel && <form onSubmit={async e => { e.preventDefault(); const url = new FormData(e.currentTarget).get("url"); await api(`/v1/handbook/articles/${sel}/attachments`, { method: "POST", body: JSON.stringify({ kind: "video", url, filename: "Video" }) }); api<Detail>(`/v1/handbook/articles/${sel}`).then(setDetail); }}>
                <label>Video link<input name="url" placeholder="https://" /></label><button className="btn">Add video link</button>
              </form>}
            </form>
          )}
        </div>
      </div>
    </>
  );
}
