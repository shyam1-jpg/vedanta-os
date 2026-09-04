import Guard from "@/components/Guard";
import HRScreen from "@/components/HRScreen";
export default function Page() { return <Guard perm="group.read"><HRScreen /></Guard>; }
