import Guard from "@/components/Guard";
import PurchasingScreen from "@/components/PurchasingScreen";
export default function Page() { return <Guard perm="group.read"><PurchasingScreen /></Guard>; }
