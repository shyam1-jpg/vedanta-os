import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { publicPageMetadata } from "@/lib/publicMetadata";
export const metadata: Metadata = {
  ...publicPageMetadata("The Vedanta Way"),
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "The Vedanta Way" },
};
export default function Home() { redirect("/sign-in/"); }
