"use client";
import type { ReactNode } from "react";

export function initials(name?: string | null) {
  const parts = String(name || "House").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "H") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ name }: { name?: string | null }) {
  return <span className="avatar" title={name || "House"} aria-hidden="true">{initials(name)}</span>;
}

export function badgeTone(status: string): "bad" | "good" | "warn" | "info" | "neutral" {
  const s = status.toLowerCase().replace(/_/g, " ");
  if (/urgent|safety|critical|serious|declined|cancel|blocked|overdue/.test(s)) return "bad";
  if (s === "read" || s === "signed" || /done|complete|resolved|closed|live|verified/.test(s)) return "good";
  if (/progress|doing|resolv|planned|assigned|acknowled/.test(s)) return "info";
  if (/unread|new|open|waiting|consider|provisional|minor/.test(s)) return "warn";
  return "neutral";
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const t = tone ?? (typeof children === "string" ? badgeTone(children) : "neutral");
  return <span className={"badge b-" + t}>{children}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function DeskBar({
  query, onQuery, placeholder = "Search", filters, onAdd, addLabel = "Add entry",
}: {
  query?: string;
  onQuery?: (value: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="desk-bar">
      {onQuery && (
        <input className="desk-search" type="search" value={query ?? ""} placeholder={placeholder} aria-label={placeholder} onChange={e => onQuery(e.target.value)} />
      )}
      {filters && <div className="desk-filters">{filters}</div>}
      {onAdd && <button type="button" className="btn primary add-entry" onClick={onAdd}>{addLabel}</button>}
    </div>
  );
}

export function EntryRow({
  selected, onClick, name, title, meta, badge, tone,
}: {
  selected?: boolean;
  onClick?: () => void;
  name?: string | null;
  title: string;
  meta?: string;
  badge?: string;
  tone?: string;
}) {
  const body = (
    <>
      <Avatar name={name} />
      <span className="entry-copy"><span className="t">{title}</span>{meta && <span className="m">{meta}</span>}</span>
      {badge && <Badge tone={tone}>{badge}</Badge>}
    </>
  );
  if (onClick) return <button type="button" className={"entry" + (selected ? " sel" : "")} onClick={onClick}>{body}</button>;
  return <article className="entry">{body}</article>;
}
