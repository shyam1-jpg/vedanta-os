import Guard from "@/components/Guard";
import Garden from "@/components/Garden";
export default function Page() { return <Guard perm="garden.log"><Garden /></Guard>; }
