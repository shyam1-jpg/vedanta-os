import "./globals.css";
import { publicPageMetadata } from "../lib/publicMetadata";
export const metadata = publicPageMetadata("Book · The Vedanta Way");
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
