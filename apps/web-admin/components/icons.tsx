"use client";
import { usePathname } from "next/navigation";

/** One matching icon per page, used in the menu and at the top of each page. */
export const PAGE_ICONS: Record<string, string> = {
  "/house/": "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  "/hub/": "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3 3 0 0 1 0 6M18 14.6c2 .5 3.3 2.2 3.8 5",
  "/manager/": "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
  "/readiness/": "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  "/pre-retreat/": "M4 5h16v16H4zM4 10h16M9 3v4M15 3v4M9 15l2 2 4-4",
  "/groups/": "M4 5h16v16H4zM4 10h16M9 3v4M15 3v4",
  "/rooms/": "M3 18V8M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-7v1M7 11.5a1.5 1.5 0 1 0 0-.01",
  "/ops/": "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  "/tasks/": "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  "/front/": "M4 20h16M6 20V10h12v10M9 10V6a3 3 0 0 1 6 0v4M12 14v2",
  "/night/": "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  "/service/": "M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v6H3zM14 15h7v6h-7z",
  "/manual/": "M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h6z",
  "/training/": "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5",
  "/housekeeping/": "M4 20h16M7 20l3-12h4l3 12M10 8V4h4v4",
  "/maintenance/": "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  "/kitchen/": "M6 13a6 6 0 1 1 12 0v2H6zM4 19h16M12 4V2",
  "/duty-manager/": "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z",
  "/programme/": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  "/finance/": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "/guests/": "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.2-4 4.3-6 8-6s6.8 2 8 6",
  "/guest-changes/": "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-3.4 3.5-5.4 6.6-5.9M17 14v6M14 17h6",
  "/guest-360/": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 18c1.2-2 3.2-3 5.5-3s4.3 1 5.5 3",
  "/hr/": "M4 5h16v16H4zM4 10h16M8 14h3M8 17h6M9 3v4M15 3v4",
  "/labour/": "M3 12h4l3-8 4 16 3-8h4",
  "/staff-corner/": "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  "/payroll/": "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01",
  "/users/": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6",
  "/sessions/": "M5 2h14v20H5zM11 18h2",
  "/review/": "M12 3v12M7 10l5 5 5-5M5 21h14",
  "/quality/": "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  "/reports/": "M6 3h9l4 4v14H6zM9 17v-4M12 17v-6M15 17v-2",
  "/purchasing/": "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01",
  "/emergency/": "M12 4l9 16H3zM12 10v4M12 17v.5",
  "/assets/": "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.5M14 20.5h.5M20 20h.5",
  "/settings/": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
};
const FALLBACK = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z";

export function PageIcon({ href, size = 18 }: { href: string; size?: number }) {
  const d = PAGE_ICONS[href] ?? FALLBACK;
  return (
    <svg className="pg-ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

/** The matching icon and section name at the top of every page. */
export function PageMark({ labels }: { labels: Record<string, { label: string; section: string }> }) {
  const p = usePathname() ?? "";
  const key = Object.keys(PAGE_ICONS).find(k => p === k || p === k.slice(0, -1) || p.startsWith(k)) ?? "";
  const info = labels[key];
  if (!info) return null;
  return (
    <div className="pg-mark" aria-hidden="true">
      <span className="pg-mark-ic"><PageIcon href={key} size={22} /></span>
      <span><small>{info.section}</small>{info.label}</span>
    </div>
  );
}
