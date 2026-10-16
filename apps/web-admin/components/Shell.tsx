"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Nav, { PAGE_LABELS } from "@/components/Nav";
import { initials } from "@/components/OpsChrome";
import PwaRegister from "@/components/PwaRegister";
import { StoreProvider, useStore } from "@/lib/store";
import { token } from "@/lib/api";

const PUBLISH_HERE = ["/news/", "/handbook/", "/ideas/", "/calendar/", "/feed/"];
const ADD_MENU: [string, string][] = [
  ["/news/", "News"],
  ["/handbook/", "Handbook article"],
  ["/ideas/", "Idea"],
  ["/calendar/", "Diary entry"],
  ["/feed/", "Moment"],
];

type Trail = { href: string; label: string };

/** Admin shell with nav. Sign-in and the organiser form stand alone. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  if (p?.startsWith("/form")) return <>{children}</>;
  if (p?.startsWith("/sign-in")) return <StoreProvider>{children}</StoreProvider>;
  return <StoreProvider><HouseShell>{children}</HouseShell></StoreProvider>;
}

function norm(path: string | null) {
  if (!path) return "/";
  return path.endsWith("/") ? path : path + "/";
}

function HouseShell({ children }: { children: ReactNode }) {
  const p = usePathname();
  const { user, ready, can, signOut } = useStore();
  const router = useRouter();
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [navOpen, setNavOpen] = useState(true);
  useEffect(() => { if (window.matchMedia("(max-width: 800px)").matches) setNavOpen(false); }, []);
  const [query, setQuery] = useState("");
  const [pop, setPop] = useState<null | "add" | "history" | "bookmark" | "user">(null);
  const [history, setHistory] = useState<Trail[]>([]);
  const [marks, setMarks] = useState<Trail[]>([]);

  useEffect(() => { setHasToken(!!token.get()); }, [user]);
  useEffect(() => {
    if (hasToken === false) {
      const next = window.location.pathname + window.location.search + window.location.hash;
      window.sessionStorage.setItem("vedanta.returnTo", next);
      router.replace("/sign-in/?next=" + encodeURIComponent(next));
      return;
    }
    if (hasToken && ready && !user) {
      const next = window.location.pathname + window.location.search + window.location.hash;
      window.sessionStorage.setItem("vedanta.returnTo", next);
      router.replace("/sign-in/?next=" + encodeURIComponent(next) + "&error=" + encodeURIComponent("Your session ended. Sign in again."));
    }
  }, [hasToken, ready, user, router, p]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem("vedanta.history") || "[]"));
      setMarks(JSON.parse(localStorage.getItem("vedanta.bookmarks") || "[]"));
    } catch { /* ignore a bad local list */ }
  }, []);

  useEffect(() => {
    const href = norm(p);
    if (!user || href.startsWith("/sign-in")) return;
    const label = PAGE_LABELS[href]?.label ?? href;
    setHistory(prev => {
      const next = [{ href, label }, ...prev.filter(row => row.href !== href)].slice(0, 12);
      localStorage.setItem("vedanta.history", JSON.stringify(next));
      return next;
    });
  }, [p, user]);

  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new CustomEvent("vedanta-search", { detail: query })), 120);
    return () => window.clearTimeout(t);
  }, [query]);

  if (hasToken === false || (ready && !user) || !user) return null;

  const href = norm(p);
  const marked = marks.some(row => row.href === href);
  const publish = can("content.publish");

  function toggleMark() {
    const label = PAGE_LABELS[href]?.label ?? href;
    setMarks(prev => {
      const next = marked ? prev.filter(row => row.href !== href) : [{ href, label }, ...prev].slice(0, 20);
      localStorage.setItem("vedanta.bookmarks", JSON.stringify(next));
      return next;
    });
  }

  function addEntry() {
    if (PUBLISH_HERE.includes(href)) {
      window.dispatchEvent(new Event("vedanta-add"));
      setPop(null);
      return;
    }
    setPop(pop === "add" ? null : "add");
  }

  function goAdd(target: string) {
    sessionStorage.setItem("vedanta.add", "1");
    setPop(null);
    router.push(target);
  }

  return (
    <div className={"kit" + (navOpen ? "" : " nav-closed")}>
      <header className="kit-top">
        <button type="button" className="kit-icon" aria-label="Menu" onClick={() => setNavOpen(v => !v)}><span className="material-icons">menu</span></button>
        <Link href="/feed/" className="kit-logo" aria-label="Home"><img src="/vedanta-official-logo.png" alt="The Vedanta" /></Link>
        <input className="kit-search" type="search" placeholder="Search..." aria-label="Search" value={query} onChange={e => setQuery(e.target.value)} />
        {publish && (
          <div className="kit-pop-wrap">
            <button type="button" className="kit-add" onClick={addEntry}><span className="material-icons">add</span> Add entry</button>
            {pop === "add" && (
              <div className="kit-pop kit-pop-down" role="menu">
                {ADD_MENU.map(([to, label]) => <button type="button" key={to} onClick={() => goAdd(to)}>{label}</button>)}
              </div>
            )}
          </div>
        )}
        <button type="button" className="kit-icon" aria-label="Notifications" onClick={() => router.push("/feed/#notifications")}><span className="material-icons">notifications_none</span></button>
        <div className="kit-pop-wrap kit-hide-sm">
          <button type="button" className="kit-icon" aria-label="History" onClick={() => setPop(pop === "history" ? null : "history")}><span className="material-icons">history</span></button>
          {pop === "history" && (
            <div className="kit-pop kit-pop-down" role="menu">
              {history.length === 0 && <p>No pages yet.</p>}
              {history.map(row => <Link key={row.href} href={row.href} onClick={() => setPop(null)}>{row.label}</Link>)}
            </div>
          )}
        </div>
        <div className="kit-pop-wrap kit-hide-sm">
          <button type="button" className={"kit-icon" + (marked ? " on" : "")} aria-label="Bookmarks" onClick={() => setPop(pop === "bookmark" ? null : "bookmark")}><span className="material-icons">{marked ? "bookmark" : "bookmark_border"}</span></button>
          {pop === "bookmark" && (
            <div className="kit-pop kit-pop-down" role="menu">
              <button type="button" onClick={toggleMark}>{marked ? "Remove this page" : "Bookmark this page"}</button>
              {marks.map(row => <Link key={row.href} href={row.href} onClick={() => setPop(null)}>{row.label}</Link>)}
            </div>
          )}
        </div>
        <div className="kit-pop-wrap">
          <button type="button" className="kit-avatar" aria-label={user.name} onClick={() => setPop(pop === "user" ? null : "user")}>{initials(user.name)}</button>
          {pop === "user" && (
            <div className="kit-pop kit-pop-down" role="menu">
              <p>{user.name}</p>
              <button type="button" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <div className="kit-body">
        <Nav open={navOpen} />
        {navOpen && <button type="button" className="kit-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
        <main className="main">{children}</main>
      </div>
      <nav className="kit-bottom" aria-label="Phone">
        <Link href="/feed/" className={href === "/feed/" ? "on" : ""}><span className="material-icons">home</span>Home</Link>
        <Link href="/news/" className={href === "/news/" ? "on" : ""}><span className="material-icons">newspaper</span>News</Link>
        <Link href="/handbook/" className={href === "/handbook/" ? "on" : ""}><span className="material-icons">menu_book</span>Book</Link>
        <Link href="/tasks/" className={href === "/tasks/" ? "on" : ""}><span className="material-icons">task_alt</span>Tasks</Link>
        <button type="button" onClick={() => setNavOpen(true)}><span className="material-icons">more_horiz</span>More</button>
      </nav>
      <PwaRegister />
    </div>
  );
}
