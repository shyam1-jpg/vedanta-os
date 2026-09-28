import Guard from "@/components/Guard";
import NightAudit from "@/components/NightAudit";
export default function Page() { return <Guard perm="night.audit"><NightAudit /></Guard>; }
