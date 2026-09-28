import Guard from "@/components/Guard";
import SopLibrary from "@/components/SopLibrary";
export default function Page() { return <Guard perm={["sop.read", "sop.manage"]}><SopLibrary /></Guard>; }
