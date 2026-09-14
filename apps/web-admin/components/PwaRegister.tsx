"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstall);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // The app remains usable online if service-worker registration is unavailable.
      });
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (online && !installPrompt) return null;

  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 1000, display: "flex", gap: 8, alignItems: "center", background: "#1a3328", color: "#fff", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 28px rgba(0,0,0,.22)", fontSize: 13 }}>
      {!online && <span>Offline · saved screens remain available</span>}
      {installPrompt && <button onClick={install} style={{ border: 0, borderRadius: 8, padding: "7px 10px", fontWeight: 700, cursor: "pointer" }}>Install Vedanta OS</button>}
    </div>
  );
}
