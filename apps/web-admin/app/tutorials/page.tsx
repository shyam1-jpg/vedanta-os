import Guard from "@/components/Guard";
import Tutorials from "@/components/Tutorials";
export default function Page() { return <Guard perm={["group.read", "cover.read", "sop.read", "content.publish"]}><Tutorials /></Guard>; }
