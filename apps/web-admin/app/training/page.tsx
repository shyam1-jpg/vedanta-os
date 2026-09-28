import Guard from "@/components/Guard";
import TrainingBoard from "@/components/TrainingBoard";
export default function Page() { return <Guard perm={["training.manage", "training.signoff"]}><TrainingBoard /></Guard>; }
