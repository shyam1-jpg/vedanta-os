"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

type Item = [string, string, string, string | null];
type Group = { label: string; items: Item[] };

/** Every house page, hotelkit collaboration first, then the original Vedanta modules. */
export const sections: Group[] = [
  { label: "Collaboration", items: [
    ["/handovers/", "Handovers", "swap_horiz", "group.read"],
    ["/news/", "News", "newspaper", "group.read"],
    ["/ideas/", "Ideas", "lightbulb", "group.read"],
    ["/handbook/", "Handbook", "menu_book", "group.read"],
    ["/tutorials/", "Tutorials", "school", "group.read"],
    ["/tasks/", "Tasks", "task_alt", "group.read"],
    ["/calendar/", "Calendar", "calendar_today", "group.read"],
    ["/repairs/", "Repairs", "build", "maintenance.read"],
    ["/requests/", "Guest requests", "room_service", "group.read"],
    ["/complaints/", "Complaints", "report", "group.read"],
  ] },
  { label: "Retreats & Groups", items: [
    ["/groups/", "The book", "event", "group.read"],
    ["/pre-retreat/", "Pre-retreat", "event_available", "group.read"],
    ["/readiness/", "Retreat readiness", "fact_check", "group.read"],
    ["/house/", "Today", "today", "group.read"],
    ["/morning/", "Morning arrivals", "wb_sunny", "group.read"],
    ["/rooms/", "Room board", "meeting_room", "group.read"],
    ["/programme/", "Programme sheet", "schedule", "group.read"],
    ["/book/", "Guest book", "hotel", null],
  ] },
  { label: "Housekeeping", items: [
    ["/housekeeping/", "Housekeeping", "cleaning_services", "group.read"],
    ["/maintenance/", "Maintenance", "handyman", "maintenance.read"],
    ["/kitchen/", "Kitchen", "restaurant", "covers.read"],
  ] },
  { label: "Front of house", items: [
    ["/ops/", "House log", "assignment", "group.read"],
    ["/front/", "Front desk", "desk", "group.read"],
    ["/night/", "Night porter", "nights_stay", "group.read"],
    ["/service/", "Department boards", "dashboard", "group.read"],
    ["/manual/", "Information", "info", "group.read"],
    ["/training/", "Training", "menu_book", "group.read"],
  ] },
  { label: "Workforce", items: [
    ["/workforce/", "Workforce home", "dashboard", "group.read"],
    ["/workforce/schedule/", "Schedule", "calendar_view_week", "group.read"],
    ["/workforce/timesheets/", "Timesheets", "schedule", "group.read"],
    ["/workforce/leave/", "Leave", "beach_access", "group.read"],
    ["/workforce/people/", "People", "groups", "group.read"],
    ["/workforce/reports/", "Workforce reports", "insights", "group.read"],
    ["/workforce/chat/", "Chat", "forum", "group.read"],
    ["/workforce/messages/", "Messages", "mail", "group.read"],
    ["/workforce/news/", "News and events", "newspaper", "group.read"],
    ["/workforce/settings/", "Workforce settings", "tune", "group.read"],
  ] },
  { label: "People", items: [
    ["/people/", "Employees", "badge", "group.read"],
    ["/guests/", "Guests", "person", "guest.read"],
    ["/guest-changes/", "Guest updates", "person_add", "guest.read"],
    ["/guest-360/", "Guest 360", "portrait", "guest.read"],
    ["/hub/", "Staff hub", "groups", "group.read"],
    ["/staff-corner/", "Staff corner", "favorite", "cover.read"],
    ["/manager/", "Manager view", "admin_panel_settings", "report.read"],
    ["/hr/", "HR & Rota", "calendar_month", "group.read"],
    ["/labour/", "Labour forecast", "show_chart", "clock.manage"],
    ["/payroll/", "Payroll", "payments", "clock.manage"],
    ["/users/", "Names & positions", "badge", "user.manage"],
    ["/sessions/", "My devices", "devices", null],
    ["/pocket/", "Staff phone", "smartphone", null],
  ] },
  { label: "More", items: [
    ["/duty-manager/", "AI Duty Manager", "auto_awesome", "group.read"],
    ["/finance/", "Finance", "account_balance", "report.read"],
    ["/review/", "Imported bookings", "upload_file", "group.update"],
    ["/quality/", "Data quality", "rule", "group.update"],
    ["/reports/", "Reports", "assessment", "report.read"],
    ["/purchasing/", "Purchasing", "shopping_cart", "group.read"],
    ["/emergency/", "Emergency & compliance", "health_and_safety", "group.read"],
    ["/assets/", "Equipment & QR", "qr_code", "maintenance.read"],
    ["/settings/", "Settings", "settings", "package.manage"],
  ] },
];

export const PAGE_LABELS: Record<string, { label: string; section: string }> = Object.fromEntries([
  ["/feed/", { label: "Home", section: "Home" }],
  ...sections.flatMap(sec => sec.items.map(([href, label]) => [href, { label, section: sec.label }] as const)),
]);

function here(path: string | null, href: string) {
  const a = (path || "/").replace(/\/$/, "") || "/";
  const b = href.replace(/\/$/, "") || "/";
  return a === b || (b !== "/" && a.startsWith(b + "/"));
}

export default function Nav({ open }: { open: boolean }) {
  const p = usePathname();
  const { can } = useStore();
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onSearch = (e: Event) => setQuery(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("vedanta-search", onSearch);
    return () => window.removeEventListener("vedanta-search", onSearch);
  }, []);

  const q = query.trim().toLowerCase();
  const groups = sections
    .map(sec => ({ ...sec, items: sec.items.filter(([, label]) => !q || `${sec.label} ${label}`.toLowerCase().includes(q)) }))
    .filter(sec => sec.items.length);

  const item = (href: string, label: string, icon: string, perm: string | null) => {
    const off = perm && !can(perm);
    const on = here(p, href);
    return (
      <Link key={href} href={off ? "#" : href} className={on ? "on" : ""} aria-disabled={!!off} aria-current={on ? "page" : undefined} style={off ? { opacity: .35, pointerEvents: "none" } : undefined}>
        <span className="material-icons">{icon}</span><span>{label}</span>
      </Link>
    );
  };

  return (
    <nav className={"kit-nav" + (open ? " open" : "")} aria-label="House">
      {(!q || "home".includes(q)) && item("/feed/", "Home", "home", "group.read")}
      {groups.map(sec => (
        <div key={sec.label}>
          <div className="kit-sec">{sec.label}</div>
          {sec.items.map(([href, label, icon, perm]) => item(href, label, icon, perm))}
        </div>
      ))}
      {q && groups.length === 0 && <p className="kit-nav-empty">No matching pages.</p>}
    </nav>
  );
}
