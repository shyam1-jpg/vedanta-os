"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }
function fileToData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export default function WorkforceChat() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string>("");
  const [thread, setThread] = useState<any>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [recording, setRecording] = useState(false);
  const load = () => api<any>("/v1/workforce-desk/chats").then(setData);
  useEffect(() => { load().catch(e => setErr(errText(e))); }, []);
  useEffect(() => {
    if (!open) return;
    const tick = () => api(`/v1/workforce-desk/chats/${open}`).then(setThread).catch(() => {});
    tick();
    const timer = window.setInterval(tick, 4000);
    return () => window.clearInterval(timer);
  }, [open]);

  async function send(extra: { data?: string; filename?: string } = {}) {
    if (!open) return;
    await api(`/v1/workforce-desk/chats/${open}/messages`, { method: "POST", body: JSON.stringify({ body, ...extra }) });
    setBody("");
    setThread(await api(`/v1/workforce-desk/chats/${open}`));
    load();
  }

  async function start(kind: "direct" | "group") {
    try {
      const saved = await api<any>("/v1/workforce-desk/chats", { method: "POST", body: JSON.stringify({ kind, title, member_ids: picked }) });
      setPicked([]); setTitle(""); setOpen(saved.id); load();
    } catch (e) { setErr(errText(e)); }
  }

  async function record() {
    if (recording || !open) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const dataUrl = await fileToData(new File([blob], "voice.webm", { type: blob.type || "audio/webm" }));
      await send({ data: dataUrl, filename: "voice.webm" });
    };
    setRecording(true);
    rec.start();
    window.setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, 4000);
  }

  const chat = (data?.chats ?? []).find((item: any) => item.id === open);
  return (
    <div className="wf-chat">
      {err && <div className="note">{err}</div>}
      <aside>
        <h2>Chats</h2>
        {(data?.chats ?? []).map((item: any) => (
          <button type="button" key={item.id} className={item.id === open ? "on" : ""} onClick={() => setOpen(item.id)}>
            <strong>{item.kind === "group" ? item.title : (item.members ?? []).filter((m: any) => m.name).map((m: any) => m.name).join(", ")}</strong>
            <span className="m">{item.last_kind && item.last_kind !== "text" ? item.last_kind : item.last_body}{item.unread ? ` · ${item.unread} unread` : ""}</span>
          </button>
        ))}
        {!data?.chats?.length && <p className="m">No chats yet.</p>}
        <h3>New</h3>
        <div className="kit-people">{(data?.people ?? []).map((p: any) => <label key={p.id} className="kit-check"><input type="checkbox" checked={picked.includes(p.id)} onChange={e => setPicked(cur => e.target.checked ? [...cur, p.id] : cur.filter(id => id !== p.id))} />{p.name}</label>)}</div>
        <label>Group name<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Kitchen late service" /></label>
        <div className="kit-pagehead-actions">
          <button type="button" className="kit-add" onClick={() => start("direct")}>Start 1:1</button>
          <button type="button" className="kit-outline" onClick={() => start("group")}>Start group</button>
        </div>
      </aside>
      <section>
        {!open && <p className="m">Pick a chat, or start a 1:1 or a group.</p>}
        {open && (
          <>
            <h2>{chat?.kind === "group" ? chat.title : "Direct chat"}</h2>
            <div className="wf-thread">
              {(thread?.messages ?? []).map((m: any) => (
                <p key={m.id}><strong>{m.author}</strong> {m.body} {m.has_file && <a href={`${API}/v1/workforce-desk/chat-files/${m.id}?token=`} onClick={async event => { event.preventDefault(); const res = await fetch(`${API}/v1/workforce-desk/chat-files/${m.id}`, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} }); const url = URL.createObjectURL(await res.blob()); window.open(url); }}>{m.kind === "voice" ? "Play voice" : m.kind === "video" ? "Play video" : m.kind === "gif" ? "Open GIF" : "Open photo"}</a>}</p>
              ))}
            </div>
            <form onSubmit={async event => { event.preventDefault(); try { await send(); setErr(""); } catch (e) { setErr(errText(e)); } }}>
              <label>Message<textarea value={body} onChange={e => setBody(e.target.value)} rows={3} /></label>
              <div className="kit-pagehead-actions">
                <button className="kit-add" type="submit">Send</button>
                <button type="button" className="kit-outline" onClick={() => record().catch(e => setErr(errText(e)))}>{recording ? "Recording…" : "Voice note"}</button>
                <label className="kit-outline">Photo, video or GIF<input type="file" accept="image/*,video/*,.gif" hidden onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { await send({ data: await fileToData(file), filename: file.name }); } catch (e) { setErr(errText(e)); } }} /></label>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
