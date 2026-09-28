"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Photo = { id: string; category: string; title: string; alt: string; caption: string; src: string };

const LABELS: Record<string, string> = {
  grounds: "Grounds",
  goshala: "Goshala",
  kitchen: "Kitchen and dining",
  rooms: "Rooms",
  other: "Other spaces",
};

export default function PhotoGallery() {
  const [items, setItems] = useState<Photo[]>([]);
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    fetch(`${API}/guest/gallery`)
      .then(res => res.ok ? res.json() : { enabled: false, items: [] })
      .then(body => { if (body?.enabled && Array.isArray(body.items)) setItems(body.items); })
      .catch(() => {});
  }, []);

  if (!items.length) return null;
  const categories = ["all", ...Array.from(new Set(items.map(item => item.category)))];
  const shown = category === "all" ? items : items.filter(item => item.category === category);
  const index = open ? shown.findIndex(item => item.id === open.id) : -1;

  return (
    <section className="gallery" data-testid="guest-gallery" aria-label="Photos of the house">
      <h2>The house</h2>
      <p className="lead">A look at the grounds, the goshala, the kitchen, and the rooms before you book. These are placeholder drawings. Guests visit the cows only with staff.</p>
      <div className="gallery-filters">
        {categories.map(item => (
          <button key={item} type="button" className={item === category ? "on" : ""} onClick={() => setCategory(item)}>{item === "all" ? "All" : LABELS[item] ?? item}</button>
        ))}
      </div>
      <div className="gallery-grid">
        {shown.map(photo => (
          <button key={photo.id} type="button" className="gallery-card" onClick={() => setOpen(photo)}>
            <img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" width={640} height={400} />
            <span>{photo.title}</span>
          </button>
        ))}
      </div>
      {open && (
        <dialog open className="gallery-light" aria-label={open.title} onClick={() => setOpen(null)}>
          <div onClick={e => e.stopPropagation()}>
            <img src={open.src} alt={open.alt} width={640} height={400} />
            <p><strong>{open.title}</strong></p>
            <p>{open.caption}</p>
            <p className="m">{open.alt}</p>
            <div className="gallery-nav">
              <button type="button" onClick={() => setOpen(shown[Math.max(0, index - 1)] ?? open)}>Previous</button>
              <button type="button" onClick={() => setOpen(null)}>Close</button>
              <button type="button" onClick={() => setOpen(shown[Math.min(shown.length - 1, index + 1)] ?? open)}>Next</button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
