"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function WorkforceBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; items: { id: string; title: string; body: string; href: string; read_at: string | null }[] } | null>(null);
  const load = () => api<any>("/v1/workforce-desk/notifications").then(setData).catch(() => {});
  useEffect(() => { load(); const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer); }, []);
  const unread = data?.unread ?? 0;
  return (
    <div className="wf-bell">
      <button type="button" className="kit-outline" aria-label="Notifications" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        Bell{unread > 0 ? <span className="wf-badge">{unread}</span> : null}
      </button>
      {open && (
        <div className="wf-bell-panel" role="dialog" aria-label="Notifications centre">
          <div className="kit-pagehead">
            <strong>Notifications</strong>
            <button type="button" className="kit-text" onClick={async () => { await api("/v1/workforce-desk/notifications/read", { method: "POST", body: "{}" }); setOpen(false); load(); }}>Mark all read</button>
          </div>
          {(data?.items ?? []).map(item => (
            <Link key={item.id} href={item.href} className={item.read_at ? "m" : ""} onClick={async () => { await api("/v1/workforce-desk/notifications/read", { method: "POST", body: JSON.stringify({ id: item.id }) }); }}>
              <strong>{item.title}</strong>
              <span className="m">{item.body}</span>
            </Link>
          ))}
          {!data?.items?.length && <p className="m">Nothing new.</p>}
        </div>
      )}
    </div>
  );
}
