import "./globals.css";
import type { Metadata } from "next";
import { FRAGMENT_STRIP_SCRIPT } from "../lib/handoff";
export const metadata: Metadata = { title: "The Vedanta Way · Pocket", referrer: "strict-origin" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GB"><head><script dangerouslySetInnerHTML={{ __html: FRAGMENT_STRIP_SCRIPT }} /></head><body>{children}</body></html>;
}
