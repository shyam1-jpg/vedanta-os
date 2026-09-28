import Guard from "@/components/Guard";
import RoomAssignBoard from "@/components/RoomAssignBoard";
export default function Page() { return <Guard perm="group.read"><RoomAssignBoard /></Guard>; }
