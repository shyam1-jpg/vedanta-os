import Guard from "@/components/Guard";
import DutyManager from "@/components/DutyManager";
export default function Page() { return <Guard perm="group.read"><DutyManager /></Guard>; }
