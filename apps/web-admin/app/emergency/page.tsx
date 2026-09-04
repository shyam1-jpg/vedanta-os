import Guard from "@/components/Guard";
import EmergencyScreen from "@/components/EmergencyScreen";
export default function Page() { return <Guard perm="group.read"><EmergencyScreen /></Guard>; }
