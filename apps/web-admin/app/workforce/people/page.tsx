"use client";
import Guard from "@/components/Guard";
import WorkforceDesk from "@/components/WorkforceDesk";
export default function Page() { return <Guard perm={["group.read", "clock.self", "cover.read", "content.publish"]}><WorkforceDesk view="people" /></Guard>; }
