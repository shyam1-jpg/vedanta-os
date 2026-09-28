import Guard from "@/components/Guard";
import ComplianceCalendar from "@/components/ComplianceCalendar";
export default function Page() { return <Guard perm="compliance.calendar"><ComplianceCalendar /></Guard>; }
