import Guard from "@/components/Guard";
import Swaps from "@/components/Swaps";
export default function Page() { return <Guard perm="shift.swap.manage"><Swaps /></Guard>; }
