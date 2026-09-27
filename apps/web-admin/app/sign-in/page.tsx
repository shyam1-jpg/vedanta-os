"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API } from "@/lib/api";
import { useStore } from "@/lib/store";
type U = { email: string; name: string; role: string };
type Prop = { name: string; kicker: string; tagline: string; website: string; company: string };
export default function SignIn() {
  const { signInDev, signInWithToken, user } = useStore(); const router = useRouter();
  const [users, setUsers] = useState<U[]>([]); const [email, setEmail] = useState(""); const [secret, setSecret] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ microsoft: boolean; dev: boolean } | null>(null);
  const [prop, setProp] = useState<Prop>({ name: "The Vedanta Way", kicker: "Retreat Center", tagline: "A beautiful grade II-listed luxury retreat centre.", website: "https://www.thevedanta.org/", company: "The Vedanta Way Ltd" });
  useEffect(() => {
    api<Prop>("/guest/property").then(p => setProp({ name: p.name, kicker: p.kicker, tagline: p.tagline ?? prop.tagline, website: p.website, company: p.company })).catch(() => {});
    const m = window.location.hash.match(/token=([^&]+)/);
    if (m) { history.replaceState(null, "", window.location.pathname); signInWithToken(decodeURIComponent(m[1])).catch(() => setErr("Sign-in did not complete. Try again.")); return; }
    const e = new URLSearchParams(window.location.search).get("error"); if (e) setErr(e);
    api<{ microsoft: boolean; dev: boolean }>("/auth/providers").then(p => {
      setProviders({ microsoft: !!p.microsoft, dev: !!p.dev });
    }).catch(() => setErr("Cannot reach the house. Try again in a moment."));
  }, [signInWithToken]);
  useEffect(() => { if (user) router.replace("/house/"); }, [user, router]);
  const loadDev = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ items: U[] }>("/auth/dev-users", { method: "POST", body: JSON.stringify({ secret }) });
      setUsers(r.items);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const go = async (addr: string) => {
    setBusy(true); setErr(null);
    try { await signInDev(addr, secret); }
    catch (e) { setErr((e as Error).message || "That development sign-in was refused."); }
    finally { setBusy(false); }
  };
  return (
    <div className="arrive">
      <section className="arrive-hero">
        <div>
          <div className="arrive-kicker">{prop.kicker}</div>
          <h1>{prop.name}</h1>
          <p className="lede">{prop.tagline}</p>
        </div>
        <div className="foot"><a href={prop.website}>{prop.website.replace(/^https?:\/\//, "")}</a><br />{prop.company}</div>
      </section>
      <section className="arrive-panel">
        <div className="arrive-card">
          <h2>Arrive</h2>
          <div className="rule" />
          {providers?.microsoft && (<>
            <p>Use your Vedanta Microsoft 365 account. Production requires a second factor.</p>
            <a className="btn primary ms" href={`${API}/auth/microsoft`}><svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>Sign in with Microsoft</a>
          </>)}
          {providers?.dev && (<>
            <p style={{ marginTop: 28 }}>Development door. This stays shut in production and on a hosted database. Only example addresses.</p>
            <input type="password" autoComplete="off" placeholder="Development secret" value={secret} onChange={e => setSecret(e.target.value)} />
            <button className="btn" disabled={!secret || busy} onClick={loadDev}>Show example staff</button>
            {users.length > 0 && <div className="users">{users.map(u => <button key={u.email} className="btn" disabled={busy} onClick={() => go(u.email)}><b>{u.name}</b><span>{u.role.replace(/_/g, " ").toLowerCase()}</span></button>)}</div>}
            <input type="email" autoComplete="off" placeholder="dev.owner@example.invalid" value={email} onChange={e => setEmail(e.target.value)} />
            <button className="btn primary" disabled={!email || !secret || busy} onClick={() => go(email)}>{busy ? "Opening…" : "Enter"}</button>
          </>)}
          {providers && !providers.microsoft && !providers.dev && <div className="note">No sign-in method is configured. Set Microsoft 365, or a development secret on this machine.</div>}
          {err && <div className="note" style={{ marginTop: 14 }}>{err}</div>}
          <p className="m" style={{ marginTop: 28 }}>Guests book at <a href="/book/">/book</a>. Staff use <a href="/pocket/">/pocket</a>.</p>
        </div>
      </section>
    </div>
  );
}
