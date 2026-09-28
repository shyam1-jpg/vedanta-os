import Guard from "@/components/Guard";
import AutoRota from "@/components/AutoRota";
export default function Page() { return <Guard perm="cover.read"><AutoRota /></Guard>; }
