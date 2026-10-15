import Guard from "@/components/Guard";
import NewsBoard from "@/components/NewsBoard";
export default function Page() { return <Guard perm={["group.read", "cover.read", "content.publish"]}><NewsBoard /></Guard>; }
