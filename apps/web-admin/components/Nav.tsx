"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { PageIcon } from "@/components/icons";

export const sections: { label: string; items: [string, string, string | null][] }[] = [
  { label: "The house", items: [["/house/", "Today", "group.read"], ["/hub/", "Staff hub", "group.read"], ["/manager/", "Manager view", "report.read"], ["/readiness/", "Retreat readiness", "group.read"], ["/pre-retreat/", "Pre-retreat", "group.read"], ["/groups/", "Bookings", "group.read"], ["/rooms/", "Room board", "group.read"]] },
  { label: "In service", items: [["/ops/", "House log", "group.read"], ["/tasks/", "Tasks", "group.read"], ["/front/", "Front desk", "group.read"], ["/night/", "Night porter", "group.read"], ["/service/", "Department boards", "group.read"], ["/manual/", "Manual", "group.read"], ["/training/", "Training", "group.read"], ["/housekeeping/", "Housekeeping", "group.read"], ["/maintenance/", "Maintenance", "maintenance.read"], ["/kitchen/", "Kitchen", "covers.read"]] },
  { label: "Intelligence", items: [["/duty-manager/", "AI Duty Manager", "group.read"], ["/programme/", "Programme sheet", "group.read"], ["/finance/", "Finance dashboard", "report.read"]] },
  { label: "People", items: [["/guests/", "Guests", "guest.read"], ["/guest-changes/", "Guest updates", "guest.read"], ["/guest-360/", "Guest 360", "guest.read"], ["/hr/", "HR & Rota", "group.read"], ["/labour/", "Labour forecast", "clock.manage"], ["/staff-corner/", "Staff corner", "cover.read"], ["/payroll/", "Payroll", "clock.manage"], ["/users/", "Names & positions", "user.manage"], ["/sessions/", "My devices", null]] },
  { label: "The estate", items: [["/review/", "Imported bookings", "group.update"], ["/quality/", "Data quality", "group.update"], ["/reports/", "Reports", "report.read"], ["/purchasing/", "Purchasing", "group.read"], ["/emergency/", "Emergency & compliance", "group.read"], ["/assets/", "Equipment & QR", "maintenance.read"], ["/settings/", "Settings", "package.manage"]] },
];
const ROLE_NAMES: Record<string, string> = {
  SYSTEM_OWNER: "System", GENERAL_MANAGER: "General manager", OPERATIONS_MANAGER: "Operations manager", ROTA_MANAGER: "Rota manager",
  FRONT_OFFICE_MANAGER: "Front office manager", RETREAT_MANAGER: "Retreat manager", RECEPTIONIST: "Reception", NIGHT_PORTER: "Night porter",
  SALES_MANAGER: "Sales manager", SALES_ASSISTANT: "Sales assistant",
  HK_SUPERVISOR: "Housekeeping supervisor", HK_ATTENDANT: "Housekeeping",
  RESTAURANT_MANAGER: "Restaurant manager", RESTAURANT_SUPERVISOR: "Restaurant supervisor", RESTAURANT_STAFF: "Waiter / waitress",
  HEAD_CHEF: "Head chef", KITCHEN_MANAGER: "Kitchen manager", SOUS_CHEF: "Sous chef", SENIOR_CHEF_DE_PARTIE: "Senior chef de partie",
  CHEF_DE_PARTIE: "Chef de partie", KITCHEN_APPRENTICE: "Apprentice", KITCHEN_ASSISTANT: "Kitchen assistant", KITCHEN_PORTER: "Kitchen porter", KITCHEN: "Kitchen",
  ESTATE_MANAGER: "Estate manager", ESTATE_ASSISTANT: "Estate manager assistant", ESTATE_MGMT_ASSISTANT: "Estate management assistant",
  GROUNDS_MANAGER: "Grounds manager", GROUNDS_ASSISTANT: "Assistant ground staff", GROUNDS: "Ground staff",
  PROGRAMME: "Programmes", MAINTENANCE: "Maintenance", FINANCE_HR: "Finance & HR", PURCHASING: "Purchasing",
};

export default function Nav() {
  const p = usePathname(); const { user, can, signOut } = useStore();
  const [search,setSearch] = useState("");
  const matches = sections.map(sec=>({...sec,items:sec.items.filter(([href,label])=>`${sec.label} ${label} ${href==='/finance/'?'invoice credit product spend':''}`.toLowerCase().includes(search.trim().toLowerCase()))})).filter(sec=>sec.items.length);
  const propertyName = (user as any)?.property_name ?? "The Vedanta Way";
  const propertyKicker = (user as any)?.property_kicker ?? "Retreat Center";
  return (
    <nav className="nav">
      <div className="brand official-house-brand"><img src="/vedanta-official-logo.png" alt="The Vedanta" width="386" height="102" /><small>{propertyName} · {propertyKicker}</small></div>
      {user && <label style={{display:"grid",gap:6,padding:"12px 16px",fontSize:11}}>Find a page<input type="search" placeholder="Search pages…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:"100%",padding:10,borderRadius:8,border:"1px solid #597165",background:"#fff",color:"#183b2d"}}/></label>}
      {user && !matches.length && <p style={{padding:16,fontSize:12}}>No matching pages.</p>}
      {user && matches.map(sec => (
        <div key={sec.label} className="nav-group">
          <div className="nav-sec">{sec.label}</div>
          {sec.items.map(([href, label, perm], i) => {
            const off = perm && !can(perm);
            return <Link key={i} href={off ? "#" : href} className={p === href ? "active" : ""} aria-disabled={!!off} style={off ? { opacity: .35, pointerEvents: "none" } : undefined}><PageIcon href={href} />{label}</Link>;
          })}
        </div>
      ))}
      <div className="who">{user ? <>{user.name}<br />{user.role_name ?? ROLE_NAMES[user.role] ?? user.role}<br /><button className="linkbtn" onClick={signOut}>Sign out</button><span className="legacy">Held for generations</span></> : "Not signed in"}</div>
    </nav>
  );
}

/** Page name + section for each menu link, used by the page header icon. */
export const PAGE_LABELS: Record<string, { label: string; section: string }> = Object.fromEntries(
  sections.flatMap(sec => sec.items.map(([href, label]) => [href, { label, section: sec.label }])),
);
