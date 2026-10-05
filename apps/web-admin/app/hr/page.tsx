import Guard from "@/components/Guard";
import HRScreen from "@/components/HRScreen";
import PlandayConnection from "@/components/PlandayConnection";
export default function Page() { return <Guard perm="group.read"><HRScreen /><div style={{padding:"0 24px"}}><PlandayConnection /></div></Guard>; }
