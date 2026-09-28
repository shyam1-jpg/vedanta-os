"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Photo = {
  id: string; category: string; title: string; alt: string; caption: string; src: string;
  audience: "guest" | "staff"; showsPeople: boolean; showsBull: boolean; hidden: boolean; sort: number; licence: string;
};

const CATEGORIES = ["grounds", "goshala", "kitchen", "rooms", "other"];

export default function GalleryAdmin() {
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<Photo[]>([]);
  const [draft, setDraft] = useState({ category: "grounds", title: "", alt: "", caption: "" });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const board = await api<{ enabled: boolean; items: Photo[] }>("/v1/gallery");
    setEnabled(board.enabled);
    setItems(board.items);
  };
  useEffect(() => { load().catch(e => setErr((e as Error).message)); }, []);

  const saveFlag = async (next: boolean) => {
    setErr(null);
    try {
      const saved = await api<{ enabled: boolean }>("/v1/gallery/settings", { method: "PUT", body: JSON.stringify({ enabled: next }) });
      setEnabled(saved.enabled);
    } catch (e) { setErr((e as Error).message); }
  };

  const add = async () => {
    setErr(null);
    try {
      await api("/v1/gallery", { method: "POST", body: JSON.stringify(draft) });
      setDraft({ category: draft.category, title: "", alt: "", caption: "" });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const save = async (photo: Photo, patch: Partial<Photo>) => {
    setErr(null);
    try {
      await api(`/v1/gallery/${photo.id}`, { method: "PATCH", body: JSON.stringify({ ...photo, ...patch }) });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div data-testid="gallery-admin">
      <h1>Photo gallery</h1>
      <p className="m">Guests can look at the grounds, the goshala, the kitchen, and the rooms before they book. The pictures here are placeholder drawings. No people. Example Bull is staff only and is never shown to guests. A cow caption has to say the visit is supervised seva with the gentle cow.</p>
      {err && <div className="note" role="alert">{err}</div>}
      <section className="panel">
        <label className="assign-check">
          <input type="checkbox" checked={enabled} onChange={e => saveFlag(e.target.checked)} />
          Show the gallery on the public guest site
        </label>
        <p className="m">{enabled ? "The gallery is on." : "The gallery is off. Guests do not see it."}</p>
      </section>
      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Add a picture</h2>
        <label>Category
          <select aria-label="Category" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
            {CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Title<input aria-label="Title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Description for someone who cannot see the picture<input aria-label="Alt text" value={draft.alt} onChange={e => setDraft({ ...draft, alt: e.target.value })} /></label>
        <label>Caption<textarea aria-label="Caption" rows={3} value={draft.caption} onChange={e => setDraft({ ...draft, caption: e.target.value })} /></label>
        <button className="btn" type="button" onClick={add}>Add placeholder</button>
      </section>
      <ul>
        {items.map(photo => (
          <li key={photo.id} data-testid={photo.showsBull || photo.audience === "staff" ? "gallery-staff-only" : "gallery-photo"} style={{ marginTop: 16 }}>
            <img src={photo.src} alt={photo.alt} width={160} height={100} style={{ objectFit: "cover", background: "#EFE6D4" }} />
            <div><strong>{photo.title}</strong> · {photo.category} · {photo.audience === "staff" ? "STAFF ONLY" : "Guest"}</div>
            <p className="m">{photo.caption}</p>
            <p className="m">{photo.licence}</p>
            <label>Caption
              <textarea aria-label={`Caption for ${photo.title}`} rows={2} defaultValue={photo.caption} onBlur={e => { if (e.target.value !== photo.caption) save(photo, { caption: e.target.value }); }} />
            </label>
            <label className="assign-check">
              <input type="checkbox" checked={photo.hidden} onChange={e => save(photo, { hidden: e.target.checked })} />
              Hide
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
