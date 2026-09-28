import Guard from "@/components/Guard";
import Maintenance from "@/components/Maintenance";
export default function Page() { return <Guard perm={["maintenance.read", "maintenance.report"]}><Maintenance /></Guard>; }
