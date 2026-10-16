"use client";
import { useEffect, useRef, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";
import { Avatar, kitStamp, useKitBus } from "@/components/OpsChrome";
import { useStore } from "@/lib/store";

type Item = { id: string; title: string; author_name: string | null; recipients: string; created_at: string; read: boolean; category: string; status: string };
type Person = { id: string; name: string };
type Template = { id: string; title: string; body_html: string; category_id: string | null; category: string | null };
type FileRow = { id: string; filename: string };
type Comment = { id: string; body: string; author_name: string | null; created_at: string; files: FileRow[] };
type Detail = Omit<Item, "recipients"> & {
  body: string; visibility: string; recipients: { id: string; name: string }[]; audience_group: string | null;
  comments: Comment[]; files: FileRow[]; can_comment: boolean; can_edit: boolean; publish_at: string | null;
  valid_from: string | null; valid_until: string | null; recipients_can_edit: boolean;
};
type Saved = { bucket: string; userId: string; group: string; from: string; to: string; categories: string[] };

const GROUPS = ["HOUSE", "FRONT", "NIGHT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];
const EMPTY: Saved = { bucket: "all", userId: "", group: "", from: "", to: "", categories: [] };

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
      </div>
      <div className="rich" contentEditable role="textbox" aria-label="Handover note" ref={ref} onInput={() => onChange(ref.current?.innerHTML ?? "")} />
    </div>
  );
}

function readData(file: File): Promise<string> {
  return new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file); });
}

async function saveFile(path: string, name: string) {
  const res = await fetch(API + path, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
  if (!res.ok) throw new Error("Could not download");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function HandoverDesk() {
  const { user } = useStore();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [recent, setRecent] = useState<Person[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateCategories, setTemplateCategories] = useState<{ id: string; title: string }[]>([]);
  const [canOperate, setCanOperate] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [filter, setFilter] = useState<Saved>(EMPTY);
  const [filtersOn, setFiltersOn] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [gear, setGear] = useState(false);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [catName, setCatName] = useState("");
  const [form, setForm] = useState({
    title: "", body_html: "", visibility: "public", recipient_ids: [] as string[], group: "", category: "",
    publish_at: "", valid_from: "", valid_until: "", recipients_can_edit: false, template_id: "",
  });
  const [attach, setAttach] = useState<File | null>(null);

  const query = new URLSearchParams();
  query.set("bucket", filter.bucket || "all");
  if (filter.userId) query.set("user", filter.userId);
  if (filter.group) query.set("group", filter.group);
  if (filter.from) query.set("from", filter.from);
  if (filter.to) query.set("to", filter.to);
  if (filter.categories.length) query.set("categories", filter.categories.join(","));

  const load = () => api<{
    items: Item[]; categories: string[]; recent: Person[]; saved: Saved | null; templates: Template[];
    template_categories: { id: string; title: string }[]; can_operate: boolean; can_publish: boolean;
  }>(`/v1/handover-desk?${query}`).then(r => {
    setItems(r.items); setCategories(r.categories); setRecent(r.recent); setTemplates(r.templates);
    setTemplateCategories(r.template_categories); setCanOperate(r.can_operate); setCanPublish(r.can_publish);
    if (r.saved && filter === EMPTY) setFilter({ ...EMPTY, ...r.saved, categories: r.saved.categories ?? [] });
  }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open handovers"));

  useEffect(() => { load(); }, [filter.bucket, filter.userId, filter.group, filter.from, filter.to, filter.categories.join("|")]);
  useEffect(() => { api<{ items: Person[] }>("/v1/ops/tasks/people").then(r => setPeople(r.items)).catch(() => {}); }, []);
  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api<Detail>(`/v1/handover-desk/${openId}`).then(async d => {
      setDetail(d);
      if (!d.read) { await api(`/v1/handover-desk/${openId}/read`, { method: "POST", body: "{}" }); load(); }
    }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the handover"));
  }, [openId]);
  useKitBus({ onSearch: () => {} });

  function applyTemplate(id: string) {
    const template = templates.find(t => t.id === id);
    if (!template) return;
    setForm(f => ({ ...f, template_id: id, title: template.title, body_html: template.body_html }));
  }

  async function create(status: "draft" | "live", saveTemplate = false) {
    const created = await api<{ id: string }>("/v1/handover-desk", {
      method: "POST",
      body: JSON.stringify({ ...form, status, body_html: form.body_html, save_template: saveTemplate }),
    });
    if (attach) {
      await api(`/v1/handover-desk/${created.id}/files`, {
        method: "POST",
        body: JSON.stringify({ data: await readData(attach), filename: attach.name }),
      });
    }
    setAttach(null);
    setAdding(false);
    setOpenId(created.id);
    load();
  }

  function toggleRecipient(id: string) {
    setForm(f => ({ ...f, recipient_ids: f.recipient_ids.includes(id) ? f.recipient_ids.filter(x => x !== id) : [...f.recipient_ids, id] }));
  }

  const recipientLabel = (names: string) => names || "The house";

  return (
    <div className="kit-page">
      <div className="kit-pagehead">
        <h1>Handovers</h1>
        <div className="kit-pagehead-actions">
          {canOperate && <button type="button" className="kit-add" onClick={() => setAdding(true)}>Add handover</button>}
          <button type="button" className="kit-outline" onClick={() => { setSelecting(v => !v); setPicked([]); }}>Select entries</button>
          <button type="button" className="kit-outline" onClick={() => setFiltersOn(v => !v)}><span className="material-icons">filter_list</span>Filters</button>
          <button type="button" className="kit-icon" aria-label="Settings" onClick={() => setGear(v => !v)}><span className="material-icons">settings</span></button>
        </div>
      </div>
      {!canOperate && <p className="m">You can read handovers and mark them read. Heads of department write them.</p>}
      {err && <div className="note">{err}</div>}
      {selecting && canOperate && (
        <div className="kit-entry-actions">
          <button type="button" className="kit-outline" disabled={!picked.length} onClick={async () => {
            await api("/v1/handover-desk/archive", { method: "POST", body: JSON.stringify({ ids: picked }) });
            setPicked([]); setSelecting(false); load();
          }}>Archive selected</button>
        </div>
      )}
      <div className="kit-crumb">The Vedanta » Handovers{detail ? ` » ${detail.title}` : ""}</div>
      {!detail && (
        <div className="kit-sheet">
          {items.map(h => (
            <div className="kit-hrow" key={h.id}>
              {selecting && <input type="checkbox" checked={picked.includes(h.id)} onChange={e => setPicked(cur => e.target.checked ? [...cur, h.id] : cur.filter(id => id !== h.id))} aria-label={`Select ${h.title}`} />}
              <button type="button" className="kit-hmain" onClick={() => setOpenId(h.id)}>
                <span className={"kit-dot " + (h.read ? "read" : "unread")} title={h.read ? "Read" : "Unread"} />
                <span>
                  <strong>{h.title}</strong>
                  <span className="m">{h.author_name ?? "House"} → {recipientLabel(h.recipients)}</span>
                </span>
                <time>{kitStamp(h.created_at)}</time>
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="kit-empty">No handovers in this view.</p>}
        </div>
      )}
      {detail && (
        <article className="kit-card kit-entry">
          <button type="button" className="kit-text" onClick={() => setOpenId(null)}>Back to handovers</button>
          <h1>{detail.title}</h1>
          <div className="kit-by">
            <Avatar name={detail.author_name} />
            <div>
              <strong>{detail.author_name ?? "House"} → {(Array.isArray(detail.recipients) ? detail.recipients.map(r => r.name).join(", ") : "") || detail.audience_group || "The house"}</strong>
              <div className="m">Created: {kitStamp(detail.created_at)}{detail.category ? ` · ${detail.category}` : ""}</div>
            </div>
            <span className={"kit-dot " + (detail.read ? "read" : "unread")} title={detail.read ? "Read" : "Unread"} />
          </div>
          <div className="kit-entry-actions">
            <button type="button" className="kit-icon" aria-label="Bookmark" onClick={() => {
              const key = "vedanta.bookmark." + detail.id;
              if (localStorage.getItem(key)) localStorage.removeItem(key); else localStorage.setItem(key, "1");
            }}><span className="material-icons">bookmark_border</span></button>
            <button type="button" className="kit-outline" onClick={() => {
              const when = window.prompt("Reminder date (YYYY-MM-DD)", detail.valid_until ?? "");
              if (when) localStorage.setItem("vedanta.reminder." + detail.id, when);
            }}><span className="material-icons">alarm</span>Reminder</button>
          </div>
          <div className="kit-prose" dangerouslySetInnerHTML={{ __html: detail.body || "" }} />
          {detail.files?.map(file => (
            <button type="button" key={file.id} className="kit-outline" onClick={() => saveFile(`/v1/handover-files/${file.id}`, file.filename).catch(e => setErr((e as Error).message))}><span className="material-icons">attach_file</span>{file.filename}</button>
          ))}
          <h2>Comments</h2>
          {detail.comments.map(c => (
            <div key={c.id} className="kit-comment">
              <strong>{c.author_name ?? "House"}</strong>
              <span className="m">{kitStamp(c.created_at)}</span>
              <p>{c.body}</p>
              {c.files?.map(file => <button type="button" key={file.id} className="kit-text" onClick={() => saveFile(`/v1/handover-files/${file.id}`, file.filename)}>{file.filename}</button>)}
            </div>
          ))}
          {detail.can_comment && (
            <form onSubmit={async e => {
              e.preventDefault();
              const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
              const saved = await api<{ id: string }>(`/v1/handover-desk/${detail.id}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
              if (file) {
                const data = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file); });
                await api(`/v1/handover-desk/${detail.id}/files`, { method: "POST", body: JSON.stringify({ data, filename: file.name, comment_id: saved.id }) });
              }
              setComment("");
              setDetail(await api<Detail>(`/v1/handover-desk/${detail.id}`));
            }}>
              <label>Comment<textarea required rows={3} value={comment} onChange={e => setComment(e.target.value)} /></label>
              <label>Attachment<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain" /></label>
              <button className="kit-add" type="submit">Comment</button>
            </form>
          )}
          {!detail.can_comment && <p className="m">You can read this note. Comments are for heads of department.</p>}
        </article>
      )}

      {filtersOn && (
        <aside className="kit-drawer" aria-label="Filters and sorting">
          <div className="kit-pagehead"><h2>Filters & sorting</h2><button type="button" className="kit-icon" aria-label="Close" onClick={() => setFiltersOn(false)}><span className="material-icons">close</span></button></div>
          <p className="m">Sort by last action</p>
          <div className="kit-sec">Mine</div>
          {[["by", "By me"], ["for", "For me"], ["with", "With me"], ["commented", "Commented"], ["unpublished", "Unpublished"]].map(([id, label]) => (
            <label key={id} className="kit-check"><input type="radio" name="bucket" checked={filter.bucket === id} onChange={() => setFilter({ ...filter, bucket: id })} />{label}</label>
          ))}
          <div className="kit-sec">My archive</div>
          <label className="kit-check"><input type="radio" name="bucket" checked={filter.bucket === "archive"} onChange={() => setFilter({ ...filter, bucket: "archive" })} />Archived</label>
          <div className="kit-sec">All</div>
          <label className="kit-check"><input type="radio" name="bucket" checked={filter.bucket === "all"} onChange={() => setFilter({ ...filter, bucket: "all" })} />Every handover I can read</label>
          <label>Person<select value={filter.userId} onChange={e => setFilter({ ...filter, userId: e.target.value })}><option value="">Anyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Group<select value={filter.group} onChange={e => setFilter({ ...filter, group: e.target.value })}><option value="">Any group</option>{GROUPS.map(g => <option key={g}>{g}</option>)}</select></label>
          <label>From<input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></label>
          <label>To<input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></label>
          <div className="kit-sec">Category</div>
          {categories.map(name => (
            <label key={name} className="kit-check"><input type="checkbox" checked={filter.categories.includes(name)} onChange={e => setFilter({ ...filter, categories: e.target.checked ? [...filter.categories, name] : filter.categories.filter(c => c !== name) })} />{name}</label>
          ))}
          <button type="button" className="kit-add" onClick={async () => { await api("/v1/handover-desk/filters", { method: "PUT", body: JSON.stringify(filter) }); setFiltersOn(false); }}>Save filters</button>
        </aside>
      )}

      {gear && (
        <aside className="kit-drawer" aria-label="Handover settings">
          <div className="kit-pagehead"><h2>Templates</h2><button type="button" className="kit-icon" aria-label="Close" onClick={() => setGear(false)}><span className="material-icons">close</span></button></div>
          {!canPublish && <p className="m">The owner and the general manager manage template categories.</p>}
          {templates.map(t => (
            <div className="kit-row" key={t.id}><strong>{t.title}</strong><span className="m">{t.category ?? "Uncategorised"}</span>{canPublish && <button type="button" className="kit-text" onClick={async () => { await api(`/v1/handover-templates/${t.id}`, { method: "DELETE" }); load(); }}>Delete</button>}</div>
          ))}
          {canPublish && (
            <form onSubmit={async e => { e.preventDefault(); await api("/v1/handover-template-categories", { method: "POST", body: JSON.stringify({ title: catName }) }); setCatName(""); load(); }}>
              <label>New template category<input value={catName} onChange={e => setCatName(e.target.value)} required /></label>
              <button className="kit-outline" type="submit">Add category</button>
            </form>
          )}
          {user && <p className="m">Signed in as {user.name}.</p>}
        </aside>
      )}

      {adding && (
        <div className="kit-modal-back" role="presentation" onClick={() => setAdding(false)}>
          <form className="kit-modal" role="dialog" aria-label="Add handover" onClick={e => e.stopPropagation()} onSubmit={async e => { e.preventDefault(); try { await create("live"); } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not create"); } }}>
            <div className="kit-pagehead"><h2>Add handover</h2><button type="button" className="kit-icon" aria-label="Close" onClick={() => setAdding(false)}><span className="material-icons">close</span></button></div>
            <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Select template<select value={form.template_id} onChange={e => applyTemplate(e.target.value)}><option value="">None</option>{templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
            <div className="kit-seg">
              <button type="button" className={form.visibility === "public" ? "on" : ""} onClick={() => setForm({ ...form, visibility: "public" })}>Public</button>
              <button type="button" className={form.visibility === "private" ? "on" : ""} onClick={() => setForm({ ...form, visibility: "private" })}>Not public</button>
            </div>
            <label>Category<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="">None</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
            <fieldset>
              <legend>Recipients</legend>
              {recent.length > 0 && (
                <div className="kit-recent">
                  <span className="m">Recently contacted</span>
                  {recent.map(p => <button type="button" key={p.id} className={form.recipient_ids.includes(p.id) ? "on" : ""} onClick={() => toggleRecipient(p.id)}>{p.name}</button>)}
                </div>
              )}
              <div className="kit-people">
                {people.map(p => (
                  <label key={p.id} className="kit-check"><input type="checkbox" checked={form.recipient_ids.includes(p.id)} onChange={() => toggleRecipient(p.id)} />{p.name}</label>
                ))}
              </div>
              <label>Or a group<select value={form.group} onChange={e => setForm({ ...form, group: e.target.value })}><option value="">No group</option>{GROUPS.map(g => <option key={g}>{g}</option>)}</select></label>
            </fieldset>
            <div>
              <span className="kit-label">Note</span>
              <Rich value={form.body_html} onChange={body_html => setForm(f => ({ ...f, body_html }))} />
            </div>
            <label>Attachment<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain" onChange={e => setAttach(e.target.files?.[0] ?? null)} /></label>
            {more && (
              <div>
                <label>Publish later<input type="datetime-local" value={form.publish_at} onChange={e => setForm({ ...form, publish_at: e.target.value })} /></label>
                <label>Valid from<input type="date" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} /></label>
                <label>Valid until<input type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} /></label>
                <label className="kit-check"><input type="checkbox" checked={form.recipients_can_edit} onChange={e => setForm({ ...form, recipients_can_edit: e.target.checked })} />Allow recipients to edit</label>
              </div>
            )}
            <button type="button" className="kit-text" onClick={() => setMore(v => !v)}>{more ? "Hide options" : "Show more options"}</button>
            <div className="kit-entry-actions">
              <button type="button" className="kit-outline" onClick={async () => { try { await create("draft"); } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); } }}>Save draft</button>
              {canPublish && <button type="button" className="kit-outline" onClick={async () => { try { await create("draft", true); } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save the template"); } }}>Add as template</button>}
              <button type="button" className="kit-outline" onClick={() => setAdding(false)}>Cancel</button>
              <button className="kit-add" type="submit">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
