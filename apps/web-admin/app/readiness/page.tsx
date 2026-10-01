import Guard from '@/components/Guard';
import RetreatReadiness from '@/components/RetreatReadiness';
export default function Page(){return <Guard perm="group.read"><RetreatReadiness/></Guard>;}
