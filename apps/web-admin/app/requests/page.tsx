import Guard from "@/components/Guard";
import GuestRequests from "@/components/GuestRequests";
export default function Page() { return <Guard perm={["group.read", "cover.read"]}><GuestRequests /></Guard>; }
