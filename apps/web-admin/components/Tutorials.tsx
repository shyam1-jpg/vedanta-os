"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";
import { useKitBus } from "@/components/OpsChrome";
import { tutorialEmbed } from "../../../domains/ops/suite";

type Item = { id: string; title: string; category: string; summary: string; video_url: string | null; filename: string | null; is_new: boolean; has_file: boolean; created_at: string };

export default function Tutorials() {
  const [items, setItems] = useState<Item[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", category: "Getting started", summary: "", video_url: "", is_new: true });

  const load = () => api<{ items: Item[]; can_publish: boolean }>("/v1/tutorials").then(r => { setItems(r.items); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open tutorials"));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSel(id);
  }, [items.length]);
  useKitBus({ onAdd: () => { if (!canPublish) return false; setAdding(true); } });
  useEffect(() => {
    if (!sel) { setFileUrl(null); return; }
    const item = items.find(t => t.id === sel);
    if (!item?.has_file) { setFileUrl(null); return; }
    let dead = false;
    fetch(API + `/v1/tutorials/${sel}/file`, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} })
      .then(r => r.blob())
      .then(b => { if (!dead) setFileUrl(URL.createObjectURL(b)); })
      .catch(() => setFileUrl(null));
    return () => { dead = true; };
  }, [sel, items]);

  const open = items.find(t => t.id === sel) ?? null;
  const embed = open?.video_url ? tutorialEmbed(open.video_url) : null;

  return (
    <div className="kit-page">
      <div className="kit-pagehead">
        <h1>Tutorials</h1>
        {canPublish && <button type="button" className="kit-add" onClick={() => setAdding(v => !v)}>{adding ? "Close" : "Add tutorial"}</button>}
      </div>
      {!canPublish && <p className="m">The owner and the general manager add tutorials. Everyone else can watch and read them.</p>}
      {err && <div className="note">{err}</div>}
      <div className="kit-crumb">{open ? <button type="button" onClick={() => setSel(null)}>The Vedanta</button> : "The Vedanta"} » Tutorials{open ? ` » ${open.title}` : ""}</div>
      {!open && (
        <div className="kit-tutorials kit-card">
          {items.map(item => (
            <button type="button" key={item.id} className="kit-tutorial" onClick={() => setSel(item.id)}>
              <span className="material-icons">{item.video_url || item.has_file ? "play_circle" : "menu_book"}</span>
              <span><strong>{item.title}</strong><small>{item.category || "House"}</small>{item.is_new && <em>NEW</em>}</span>
            </button>
          ))}
          {items.length === 0 && <p className="kit-empty">No tutorials yet.</p>}
        </div>
      )}
      {open && (
        <article className="kit-card kit-entry">
          <h1>{open.title}{open.is_new && <em className="kit-new">NEW</em>}</h1>
          <p className="m">{open.category}</p>
          <div className="kit-prose">{open.summary}</div>
          {embed && embed.includes("/embed/") && <iframe className="kit-video" src={embed} title={open.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />}
          {embed && !embed.includes("/embed/") && <video className="kit-video" controls src={embed} />}
          {open.video_url && !embed && <p><a href={open.video_url} target="_blank" rel="noreferrer">{open.video_url}</a></p>}
          {fileUrl && open.filename?.toLowerCase().endsWith(".pdf") && <iframe className="kit-video" src={fileUrl} title={open.filename ?? "PDF"} />}
          {fileUrl && !open.filename?.toLowerCase().endsWith(".pdf") && <video className="kit-video" controls src={fileUrl} />}
          {canPublish && <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/tutorials/${open.id}`, { method: "DELETE" }); setSel(null); load(); }}>Remove</button>}
        </article>
      )}
      {canPublish && adding && (
        <form className="kit-card" onSubmit={async e => {
          e.preventDefault();
          const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
          let data: string | undefined;
          if (file) data = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file); });
          try {
            await api("/v1/tutorials", { method: "POST", body: JSON.stringify({ ...form, data, filename: file?.name }) });
            setForm({ title: "", category: "Getting started", summary: "", video_url: "", is_new: true });
            setAdding(false); load();
          } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not add the tutorial"); }
        }}>
          <h2>Add tutorial</h2>
          <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Category<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
          <label>Summary<textarea rows={3} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
          <label>Video link<input value={form.video_url} onChange={e => setForm({ ...form, video_url: e.target.value })} placeholder="https://youtu.be/… or https://vimeo.com/…" /></label>
          <label>Or upload MP4, WebM or PDF<input name="file" type="file" accept="video/mp4,video/webm,application/pdf" /></label>
          <label className="kit-check"><input type="checkbox" checked={form.is_new} onChange={e => setForm({ ...form, is_new: e.target.checked })} />Show the NEW badge</label>
          <button className="kit-add" type="submit">Publish</button>
        </form>
      )}
    </div>
  );
}
