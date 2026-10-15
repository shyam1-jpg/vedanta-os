import Guard from "@/components/Guard";
import Repairs from "@/components/Repairs";
export default function Page() { return <Guard perm="maintenance.read"><Repairs /></Guard>; }
