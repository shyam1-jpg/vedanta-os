import Guard from "@/components/Guard";
import Briefing from "@/components/Briefing";
export default function Page() { return <Guard perm="briefing.read"><Briefing /></Guard>; }
