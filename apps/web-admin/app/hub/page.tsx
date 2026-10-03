import Guard from "@/components/Guard";
import StaffHub from "@/components/StaffHub";
export default function Page() { return <Guard perm="group.read"><StaffHub /></Guard>; }
