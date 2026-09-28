import Guard from "@/components/Guard";
import KitchenStock from "@/components/KitchenStock";
export default function Page() { return <Guard perm="kitchen.stock"><KitchenStock /></Guard>; }
