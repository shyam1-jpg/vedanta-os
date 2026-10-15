import Guard from "@/components/Guard";
import Handbook from "@/components/Handbook";
export default function Page() { return <Guard perm={["group.read", "cover.read", "sop.read", "content.publish"]}><Handbook /></Guard>; }
