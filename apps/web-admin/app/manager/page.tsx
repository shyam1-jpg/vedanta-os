import Guard from "@/components/Guard";
import ManagerDesk from "@/components/ManagerDesk";
export default function Page() { return <Guard perm="report.read"><ManagerDesk /></Guard>; }
