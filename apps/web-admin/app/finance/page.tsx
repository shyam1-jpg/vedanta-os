import Guard from "@/components/Guard";
import FinanceDashboard from "@/components/FinanceDashboard";
export default function Page() { return <Guard perm="report.read"><FinanceDashboard /></Guard>; }
