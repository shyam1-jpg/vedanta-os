import Guard from "@/components/Guard";
import Employees from "@/components/Employees";
export default function Page() { return <Guard perm={["group.read", "cover.read", "content.publish"]}><Employees /></Guard>; }
