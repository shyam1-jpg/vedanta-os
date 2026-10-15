import { Suspense } from "react";
import Guard from "@/components/Guard";
import HandbookPrint from "@/components/HandbookPrint";
export default function Page() {
  return <Guard perm={["group.read", "cover.read", "sop.read", "content.publish"]}><Suspense fallback={<p className="empty">Opening the article…</p>}><HandbookPrint /></Suspense></Guard>;
}
