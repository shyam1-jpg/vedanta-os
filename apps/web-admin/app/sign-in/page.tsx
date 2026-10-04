"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
type U = { email: string; name: string; role: string };
type Prop = { name: string; kicker: string; tagline: string; website: string; company: string };
export default function SignIn() {
  const { signIn, signInWithToken, user } = useStore(); const router = useRouter();
  const [users, setUsers] = useState<U[]>([]); const [email, setEmail] = useState("shyam_1@hotmail.co.uk"); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ microsoft: boolean; dev: boolean; email: boolean; email_code: boolean } | null>(null);
  const [codeSent, setCodeSent] = useState(false); const [code, setCode] = useState(""); const [message, setMessage] = useState("");
  const [prop, setProp] = useState<Prop>({ name: "The Vedanta Way", kicker: "Retreat Center", tagline: "A beautiful grade II-listed luxury retreat centre.", website: "https://www.thevedanta.org/", company: "The Vedanta Way Ltd" });
  useEffect(() => {
    api<Prop>("/guest/property").then(p => setProp({ name: p.name, kicker: p.kicker, tagline: p.tagline ?? prop.tagline, website: p.website, company: p.company })).catch(() => {});
    const requestedNext = new URLSearchParams(window.location.search).get("next");
    if (requestedNext?.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\")) window.sessionStorage.setItem("vedanta.returnTo", requestedNext);
    const m = window.location.hash.match(/token=([^&]+)/);
    if (m) { history.replaceState(null, "", window.location.pathname + window.location.search); signInWithToken(m[1]).catch(() => setErr("Sign-in did not complete. Try again.")); return; }
    const e = new URLSearchParams(window.location.search).get("error"); if (e) setErr(e);
    api<{ microsoft: boolean; dev: boolean; email?: boolean; email_code?: boolean }>("/auth/providers").then(p => {
      const next = { microsoft: !!p.microsoft, dev: !!p.dev, email: p.email ?? !!p.dev, email_code: !!p.email_code };
      setProviders(next);
      if (next.dev) api<{ items: U[] }>("/auth/users").then(r => setUsers(r.items)).catch(() => {});
    }).catch(() => setErr("Cannot reach the house. Try again in a moment."));
  }, [signInWithToken]);
  useEffect(() => { if (user) {
    const next = new URLSearchParams(window.location.search).get("next") || window.sessionStorage.getItem("vedanta.returnTo");
    window.sessionStorage.removeItem("vedanta.returnTo");
    router.replace(next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/house/");
  } }, [user, router]);
  const go = async (e: string) => { setBusy(true); setErr(null); try { await signIn(e); } catch { setErr("No one on the staff list has that email."); } finally { setBusy(false); } };
  const requestCode = async () => { setBusy(true); setErr(null); try {
    const r = await api<{ message: string }>("/auth/email-code/request", { method: "POST", body: JSON.stringify({ email }) });
    setCodeSent(true); setMessage(r.message);
  } catch (e) { setErr(e instanceof ApiError ? e.problem.detail : "Could not send a code"); } finally { setBusy(false); } };
  const verifyCode = async () => { setBusy(true); setErr(null); try {
    const r = await api<{ token: string }>("/auth/email-code/verify", { method: "POST", body: JSON.stringify({ email, code }) });
    await signInWithToken(r.token);
  } catch (e) { setErr(e instanceof ApiError ? e.problem.detail : "Could not verify the code"); } finally { setBusy(false); } };
  return (
    <div className="arrive">
      <section className="arrive-hero">
        <div>
          <img className="official-house-logo" src="/vedanta-official-logo.png" alt="The Vedanta — The Vedanta Way Ltd" width="386" height="102" />
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
          {providers?.email && (<>
            <p>There is no password. Your email opens the house.</p>
            <input type="email" autoComplete="email" placeholder="shyam_1@hotmail.co.uk" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && go(email)} />
            <button className="btn primary" disabled={!email || busy} onClick={() => go(email)}>{busy ? "Opening…" : "Enter"}</button>
          </>)}
          {providers?.email_code && !providers.email && <div className="staff-code-login">
            <p>Enter your staff email. We will send a one-time code that expires in 10 minutes.</p>
            <label htmlFor="staff-email">Staff email</label>
            <input id="staff-email" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setCodeSent(false); setCode(""); }} />
            <button className="btn primary" disabled={!email || busy} onClick={requestCode}>{busy ? "Please wait…" : codeSent ? "Send another code" : "Email me a code"}</button>
            {codeSent && <div className="code-entry"><p role="status">{message}</p><label htmlFor="staff-code">Eight-digit code</label>
              <input id="staff-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} onKeyDown={e => e.key === "Enter" && code.length === 8 && verifyCode()} />
              <button className="btn primary" disabled={code.length !== 8 || busy} onClick={verifyCode}>Sign in</button></div>}
          </div>}
          {providers?.dev && (<>
            <p style={{ marginTop: 28 }}>Development — choose a member of the house:</p>
            <div className="users">{users.map(u => <button key={u.email} className="btn" disabled={busy} onClick={() => go(u.email)}><b>{u.name}</b><span>{u.role.replace(/_/g, " ").toLowerCase()}</span></button>)}</div>
          </>)}
          {providers?.microsoft && !providers.email && (<>
            <p>Use your Vedanta Microsoft 365 account.</p>
            <a className="btn primary ms" href={`${API}/auth/microsoft`}><svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>Sign in with Microsoft</a>
          </>)}
          {providers && !providers.microsoft && !providers.dev && !providers.email && !providers.email_code && <div className="note">Staff sign-in is awaiting email delivery or Microsoft configuration. Contact the house administrator.</div>}
          {err && <div className="note" style={{ marginTop: 14 }}>{err}</div>}
          <p className="m" style={{ marginTop: 28 }}>Guests book at <a href="/book/">/book</a>. Staff use <a href="/pocket/">/pocket</a>.</p>
        </div>
      </section>
    </div>
  );
}
