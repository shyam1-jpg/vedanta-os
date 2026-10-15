import Guard from "@/components/Guard";
import HouseCalendar from "@/components/HouseCalendar";
export default function Page() { return <Guard perm={["group.read", "cover.read", "content.publish"]}><HouseCalendar /></Guard>; }
