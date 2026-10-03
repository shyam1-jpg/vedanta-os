import Guard from "@/components/Guard";
import StaffTraining from "@/components/StaffTraining";
export default function Page() { return <Guard perm={["group.read", "sop.read", "cover.read"]}><StaffTraining /></Guard>; }
