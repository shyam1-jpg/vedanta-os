import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/publicMetadata";
export const metadata: Metadata = {
  ...publicPageMetadata("Sign in · The Vedanta Way"),
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "The Vedanta Way" },
};
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
