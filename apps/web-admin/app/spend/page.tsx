import Guard from "@/components/Guard";
import Spend from "@/components/Spend";
export default function Page() { return <Guard perm="spend.log"><Spend /></Guard>; }
