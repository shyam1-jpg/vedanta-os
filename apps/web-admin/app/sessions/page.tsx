import Guard from "@/components/Guard";
import SessionsScreen from "@/components/SessionsScreen";
export default function Page() { return <Guard perm="group.read"><SessionsScreen /></Guard>; }
