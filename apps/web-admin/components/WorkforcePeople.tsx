"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }
async function openFile(path: string) {
  const res = await fetch(API + path, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
  if (!res.ok) throw new Error("Could not open that file");
  window.open(URL.createObjectURL(await res.blob()));
}
function fileToData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export default function WorkforcePeople() {
  const [list, setList] = useState<any[]>([]);
  const [id, setId] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [folder, setFolder] = useState("General");
  const [payslip, setPayslip] = useState({ period_label: "", period_start: "", period_end: "" });
  useEffect(() => { api<any>("/v1/workforce-desk/people").then(r => setList(r.people ?? [])).catch(e => setErr(errText(e))); }, []);
  async function open(personId: string) {
    setId(personId);
    setProfile(await api(`/v1/workforce-desk/people/${personId}`));
    setDocs((await api<any>(`/v1/workforce-desk/documents?user_id=${personId}`)).items ?? []);
  }
  const folders = [...new Set(docs.map(d => d.folder || "General"))];
  return (
    <div className="wf-people">
      {err && <div className="note">{err}</div>}
      <div className="kit-sheet">
        {list.map(p => <button type="button" key={p.id} className="kit-row" onClick={() => open(p.id).catch(e => setErr(errText(e)))}><strong>{p.name}</strong><span className="m">{p.department_name || p.department || "House"} · {p.role_name}</span></button>)}
      </div>
      {profile && (
        <article className="kit-card">
          <h2>{profile.name}</h2>
          <p className="m">{profile.department_name} · {profile.role_name}{profile.contracted_hours ? ` · ${profile.contracted_hours}h contracted` : ""}</p>
          <form onSubmit={async event => { event.preventDefault(); try { await api(`/v1/workforce-desk/people/${id}`, { method: "PATCH", body: JSON.stringify({ phone: profile.phone, language: profile.language, email_notifications: profile.email_notifications }) }); setErr(""); } catch (e) { setErr(errText(e)); } }}>
            <label>Email<input value={profile.email ?? ""} readOnly /></label>
            <label>Phone<input value={profile.phone ?? ""} onChange={e => setProfile({ ...profile, phone: e.target.value })} /></label>
            <label>Language<select value={profile.language ?? "en"} onChange={e => setProfile({ ...profile, language: e.target.value })}><option value="en">English</option><option value="pl">Polish</option><option value="ro">Romanian</option><option value="bg">Bulgarian</option><option value="es">Spanish</option></select></label>
            <label className="kit-check"><input type="checkbox" checked={profile.email_notifications !== false} onChange={e => setProfile({ ...profile, email_notifications: e.target.checked })} />Email me workforce notifications</label>
            <button className="kit-add" type="submit">Save profile</button>
          </form>
          <h3>Payslips</h3>
          {(profile.payslips ?? []).map((p: any) => <p key={p.id}>{p.period_label} · £{(p.net_pence / 100).toFixed(2)} {p.has_file && <button type="button" className="kit-text" onClick={() => openFile(`/v1/workforce-desk/payslips/${p.id}`).catch(e => setErr(errText(e)))}>PDF</button>}</p>)}
          <form onSubmit={async event => {
            event.preventDefault();
            const file = (event.currentTarget.elements.namedItem("pdf") as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
              await api("/v1/workforce-desk/payslips", { method: "POST", body: JSON.stringify({ user_id: id, ...payslip, filename: file.name, data: await fileToData(file) }) });
              open(id);
            } catch (e) { setErr(errText(e)); }
          }}>
            <div className="frow">
              <label>Label<input value={payslip.period_label} onChange={e => setPayslip({ ...payslip, period_label: e.target.value })} placeholder="October 2026" /></label>
              <label>From<input type="date" value={payslip.period_start} onChange={e => setPayslip({ ...payslip, period_start: e.target.value })} /></label>
              <label>To<input type="date" value={payslip.period_end} onChange={e => setPayslip({ ...payslip, period_end: e.target.value })} /></label>
              <label>PDF<input name="pdf" type="file" accept="application/pdf" /></label>
            </div>
            <button className="kit-outline" type="submit">Upload payslip</button>
          </form>
          <h3>Documents</h3>
          {folders.map(name => (
            <div key={name}>
              <strong>{name}</strong>
              {docs.filter(d => (d.folder || "General") === name).map(d => <p key={d.id}>{d.title}{d.has_file && <button type="button" className="kit-text" onClick={() => openFile(`/v1/workforce-desk/documents/${d.id}`).catch(e => setErr(errText(e)))}>Open</button>}</p>)}
            </div>
          ))}
          <form onSubmit={async event => {
            event.preventDefault();
            const file = (event.currentTarget.elements.namedItem("doc") as HTMLInputElement).files?.[0];
            const title = (event.currentTarget.elements.namedItem("title") as HTMLInputElement).value;
            try {
              await api("/v1/workforce-desk/documents", { method: "POST", body: JSON.stringify({ user_id: id, folder, title, filename: file?.name, data: file ? await fileToData(file) : undefined }) });
              open(id);
            } catch (e) { setErr(errText(e)); }
          }}>
            <div className="frow">
              <label>Folder<input value={folder} onChange={e => setFolder(e.target.value)} /></label>
              <label>Title<input name="title" required /></label>
              <label>File<input name="doc" type="file" accept="application/pdf,image/*" /></label>
            </div>
            <button className="kit-outline" type="submit">Upload to folder</button>
          </form>
        </article>
      )}
    </div>
  );
}
