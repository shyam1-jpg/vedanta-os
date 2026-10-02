import Guard from "@/components/Guard";
import PreRetreat from "@/components/PreRetreat";

export default function Page() {
  return <Guard perm="group.read"><PreRetreat /></Guard>;
}
