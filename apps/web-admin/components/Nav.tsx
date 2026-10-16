"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

export const sections: { label: string; items: [string, string, string | null][] }[] = [
  { label: "Operations", items: [["/feed/", "Home", "group.read"], ["/handbook/", "Handbook", "group.read"], ["/news/", "News", "group.read"], ["/ideas/", "Ideas", "group.read"], ["/calendar/", "Calendar", "group.read"], ["/handovers/", "Handovers", "group.read"], ["/tasks/", "Tasks", "group.read"], ["/repairs/", "Repairs", "maintenance.read"], ["/requests/", "Guest requests", "group.read"], ["/complaints/", "Complaints", "group.read"], ["/housekeeping/", "Housekeeping", "group.read"], ["/people/", "Employees", "group.read"]] },
  { label: "The house", items: [["/house/", "Today", "group.read"], ["/hub/", "Staff hub", "group.read"], ["/manager/", "Manager view", "report.read"], ["/readiness/", "Retreat readiness", "group.read"], ["/pre-retreat/", "Pre-retreat", "group.read"], ["/groups/", "Bookings", "group.read"], ["/rooms/", "Room board", "group.read"]] },
  { label: "In service", items: [["/ops/", "House log", "group.read"], ["/front/", "Front desk", "group.read"], ["/night/", "Night porter", "group.read"], ["/service/", "Department boards", "group.read"], ["/manual/", "Manual", "group.read"], ["/training/", "Training", "group.read"], ["/maintenance/", "Maintenance", "maintenance.read"], ["/kitchen/", "Kitchen", "covers.read"]] },
  { label: "Intelligence", items: [["/duty-manager/", "AI Duty Manager", "group.read"], ["/programme/", "Programme sheet", "group.read"], ["/finance/", "Finance dashboard", "report.read"]] },
  { label: "People", items: [["/people/", "Employees", "group.read"], ["/guests/", "Guests", "guest.read"], ["/guest-changes/", "Guest updates", "guest.read"], ["/guest-360/", "Guest 360", "guest.read"], ["/hr/", "HR & Rota", "group.read"], ["/labour/", "Labour forecast", "clock.manage"], ["/staff-corner/", "Staff corner", "cover.read"], ["/payroll/", "Payroll", "clock.manage"], ["/users/", "Names & positions", "user.manage"], ["/sessions/", "My devices", null]] },
  { label: "The estate", items: [["/review/", "Imported bookings", "group.update"], ["/quality/", "Data quality", "group.update"], ["/reports/", "Reports", "report.read"], ["/purchasing/", "Purchasing", "group.read"], ["/emergency/", "Emergency & compliance", "group.read"], ["/assets/", "Equipment & QR", "maintenance.read"], ["/settings/", "Settings", "package.manage"]] },
];

const COLLAB: [string, string, string, string | null][] = [
  ["/handovers/", "Handovers", "swap_horiz", "group.read"],
  ["/news/", "News", "newspaper", "group.read"],
  ["/ideas/", "Ideas", "lightbulb", "group.read"],
  ["/handbook/", "Handbook", "menu_book", "group.read"],
  ["/tasks/", "Tasks", "task_alt", "group.read"],
  ["/calendar/", "Calendar", "calendar_today", "group.read"],
  ["/repairs/", "Repairs", "build", "maintenance.read"],
  ["/requests/", "Guest requests", "room_service", "group.read"],
  ["/complaints/", "Complaints", "report", "group.read"],
];

const PRIMARY = new Set(["/feed/", ...COLLAB.map(row => row[0]), "/housekeeping/", "/people/", "/manual/"]);

function here(path: string | null, href: string) {
  const a = (path || "/").replace(/\/$/, "") || "/";
  const b = href.replace(/\/$/, "") || "/";
  return a === b;
}

export default function Nav({ open }: { open: boolean }) {
  const p = usePathname();
  const { can } = useStore();
  const [more, setMore] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node)) setMore(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [more]);

  const extra = sections.flatMap(sec => sec.items)
    .filter(([href], i, all) => !PRIMARY.has(href) && all.findIndex(row => row[0] === href) === i);

  const item = (href: string, label: string, icon: string, perm: string | null) => {
    const off = perm && !can(perm);
    const on = here(p, href);
    return (
      <Link key={href} href={off ? "#" : href} className={on ? "on" : ""} aria-disabled={!!off} aria-current={on ? "page" : undefined} style={off ? { opacity: .35, pointerEvents: "none" } : undefined} onClick={() => setMore(false)}>
        <span className="material-icons">{icon}</span>{label}
      </Link>
    );
  };

  const moreOn = more || extra.some(([href]) => here(p, href)) || here(p, "/people/") || here(p, "/manual/");
  return (
    <nav className={"kit-nav" + (open ? " open" : "")} aria-label="House">
      {item("/feed/", "Home", "home", "group.read")}
      <div className="kit-sec">Collaboration</div>
      {COLLAB.map(([href, label, icon, perm]) => item(href, label, icon, perm))}
      <div className="kit-sec">Housekeeping</div>
      {item("/housekeeping/", "Housekeeping", "cleaning_services", "group.read")}
      <div className="kit-more" ref={pop}>
        {more && (
          <div className="kit-pop" role="menu">
            {item("/people/", "Employees", "badge", "group.read")}
            {item("/manual/", "Information", "info", "group.read")}
            <div className="kit-sec">House tools</div>
            {extra.map(([href, label, perm]) => item(href, label, "chevron_right", perm))}
          </div>
        )}
        <button type="button" className={"kit-link" + (moreOn ? " on" : "")} onClick={() => setMore(v => !v)} aria-expanded={more}>
          <span className="material-icons">more_horiz</span>More
        </button>
      </div>
    </nav>
  );
}

export const PAGE_LABELS: Record<string, { label: string; section: string }> = Object.fromEntries(
  sections.flatMap(sec => sec.items.map(([href, label]) => [href, { label, section: sec.label }])),
);
