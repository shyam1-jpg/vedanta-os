import Guard from "@/components/Guard";
import Complaints from "@/components/Complaints";
export default function Page() { return <Guard perm={["group.read", "guest.read", "content.publish"]}><Complaints /></Guard>; }
