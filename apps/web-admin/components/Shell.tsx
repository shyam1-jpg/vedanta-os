"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Nav, { PAGE_LABELS } from "@/components/Nav";
import { PageMark } from "@/components/icons";
import PwaRegister from "@/components/PwaRegister";
import { StoreProvider, useStore } from "@/lib/store";
import { token } from "@/lib/api";

/** Admin shell with nav. Sign-in and the organiser form stand alone. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  if (p?.startsWith("/form")) return <>{children}</>;
  if (p?.startsWith("/sign-in")) return <StoreProvider>{children}</StoreProvider>;
  return <StoreProvider><HouseShell>{children}</HouseShell></StoreProvider>;
}

function HouseShell({ children }: { children: ReactNode }) {
  const p = usePathname();
  const { user, ready } = useStore();
  const router = useRouter();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

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

  if (hasToken === false || (ready && !user) || !user) return null;
  return <div className="shell"><Nav /><main className="main"><PageMark labels={PAGE_LABELS} />{children}</main><PwaRegister /></div>;
}
