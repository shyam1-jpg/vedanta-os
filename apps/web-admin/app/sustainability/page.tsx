import Guard from "@/components/Guard";
import Sustainability from "@/components/Sustainability";
export default function Page() { return <Guard perm="sustainability.log"><Sustainability /></Guard>; }
