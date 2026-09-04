import Guard from "@/components/Guard";
import Guest360 from "@/components/Guest360";
export default function Page() { return <Guard perm="guest.read"><Guest360 /></Guard>; }
