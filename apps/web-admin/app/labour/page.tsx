import Guard from "@/components/Guard";
import LabourForecast from "@/components/LabourForecast";
export default function Page() { return <Guard perm="clock.manage"><LabourForecast /></Guard>; }
