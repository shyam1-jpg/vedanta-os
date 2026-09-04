import Guard from "@/components/Guard";
import ProgrammeSheet from "@/components/ProgrammeSheet";
export default function Page() { return <Guard perm="group.read"><ProgrammeSheet /></Guard>; }
