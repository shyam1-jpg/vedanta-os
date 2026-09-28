import "./globals.css";
import { FRAGMENT_STRIP_SCRIPT } from "../lib/handoff";
import { publicPageMetadata } from "../lib/publicMetadata";
export const metadata = { ...publicPageMetadata("Pocket · The Vedanta Way"), referrer: "strict-origin" as const };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GB"><head><script dangerouslySetInnerHTML={{ __html: FRAGMENT_STRIP_SCRIPT }} /></head><body>{children}</body></html>;
}
