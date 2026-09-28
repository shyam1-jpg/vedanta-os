import Guard from "@/components/Guard";
import OrgTree from "@/components/OrgTree";
export default function Page() { return <Guard perm="org.read"><OrgTree /></Guard>; }
