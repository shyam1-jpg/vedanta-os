import Guard from "@/components/Guard";
import CowCare from "@/components/CowCare";
export default function Page() { return <Guard perm="goshala.care"><CowCare /></Guard>; }
