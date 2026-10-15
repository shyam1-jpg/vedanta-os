import Guard from "@/components/Guard";
import IdeasBoard from "@/components/IdeasBoard";
export default function Page() { return <Guard perm={["group.read", "cover.read", "content.publish"]}><IdeasBoard /></Guard>; }
