import Guard from "@/components/Guard";
import HomeFeed from "@/components/HomeFeed";
export default function Page() { return <Guard perm={["group.read", "cover.read", "content.publish"]}><HomeFeed /></Guard>; }
