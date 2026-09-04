import "./globals.css";
import type { Metadata } from "next";
import Shell from "@/components/Shell";
export const metadata: Metadata = {
  title: "The Vedanta Way",
  description: "Vedanta Oway Retreat — Operating System",
  manifest: "/manifest.json",
  themeColor: "#1a3328",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Vedanta OS" },
  viewport: { width: "device-width", initialScale: 1, maximumScale: 1 },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Vedanta OS" />
        <meta name="theme-color" content="#1a3328" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
