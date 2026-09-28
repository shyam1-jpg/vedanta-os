"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Category = { code: string; label: string };

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("Attach a photo as an image")); el.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the photo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
    if (data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export default function LostReport() {
  const [enabled, setEnabled] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ description: "", category: "other", place: "", happened_on: "", contact_name: "", contact_email: "", contact_phone: "", booking_ref: "", consent: false, photo: "" });
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API}/public/lost-report`)
      .then(res => res.ok ? res.json() : { enabled: false })
      .then(body => {
        if (!body?.enabled) return;
        setEnabled(true);
        const list = Array.isArray(body.categories) ? body.categories : [];
        setCategories(list);
        if (list[0]?.code) setForm(f => ({ ...f, category: list[0].code }));
      })
      .catch(() => {});
  }, []);

  if (!enabled) return null;

  const submit = async () => {
    setErr(null);
    const res = await fetch(`${API}/public/lost-report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(body.detail ?? "Could not save the report"); return; }
    setDone(true);
  };

  return (
    <section className="lost-report card" data-testid="lost-report-form">
      <h2 style={{ fontSize: 26 }}>I lost something</h2>
      <p className="m">During or after your stay. We contact you about this item only if you agree. The photo stays with the house.</p>
      {err && <p role="alert">{err}</p>}
      {done ? <p>Thank you. The house has the report. Staff confirm a match before anyone is told.</p> : (
        <form onSubmit={e => { e.preventDefault(); submit(); }}>
          <label>What is missing<input aria-label="What is missing" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <label>Category
            <select aria-label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
          <label>Where you last had it<input aria-label="Where you last had it" value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} /></label>
          <label>When<input type="date" aria-label="When you lost it" value={form.happened_on} onChange={e => setForm({ ...form, happened_on: e.target.value })} /></label>
          <label>Your name<input aria-label="Your name" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} /></label>
          <label>Email<input type="email" aria-label="Email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></label>
          <label>Phone<input aria-label="Phone" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} /></label>
          <label>Booking reference, if you have it<input aria-label="Booking reference" value={form.booking_ref} onChange={e => setForm({ ...form, booking_ref: e.target.value })} /></label>
          <label>Photo, if you have one
            <input type="file" accept="image/*" aria-label="Photo" onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              try { const photo = await shrink(file); setForm(f => ({ ...f, photo })); setErr(null); }
              catch (err) { setErr((err as Error).message); }
            }} />
          </label>
          <label><input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} /> I agree the house may contact me about this item.</label>
          <button className="btn" type="submit" disabled={!form.consent}>Send the report</button>
        </form>
      )}
    </section>
  );
}
