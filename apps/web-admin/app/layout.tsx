import "./globals.css";
import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
export const metadata: Metadata = {
  title: "The Vedanta Way",
  description: "Vedanta Oway Retreat — Operating System",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Vedanta OS" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1a3328",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
