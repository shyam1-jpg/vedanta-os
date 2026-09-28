import Guard from "@/components/Guard";
import LostFound from "@/components/LostFound";
export default function Page() { return <Guard perm="lostfound.log"><LostFound /></Guard>; }
