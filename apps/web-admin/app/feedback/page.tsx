import Guard from "@/components/Guard";
import FeedbackBoard from "@/components/FeedbackBoard";
export default function Page() { return <Guard perm="group.read"><FeedbackBoard /></Guard>; }
