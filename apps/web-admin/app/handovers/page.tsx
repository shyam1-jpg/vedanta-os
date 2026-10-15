import Guard from "@/components/Guard";
import HandoverDesk from "@/components/HandoverDesk";
export default function Page() { return <Guard perm={["group.read", "cover.read"]}><HandoverDesk /></Guard>; }
