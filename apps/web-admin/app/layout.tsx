import "./globals.css";
import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
export const metadata: Metadata = {
  title: "The Vedanta Way",
  description: "Vedanta Oway Retreat — Operating System",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Vedanta OS" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#102A23" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Vedanta OS" />
        <meta name="theme-color" content="#102A23" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
