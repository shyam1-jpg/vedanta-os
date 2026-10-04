"use client";
import Guard from '@/components/Guard';
import {api} from '@/lib/api';
import MorningDashboard from '../../../web-staff/components/MorningDashboard';
export default function Page(){return <Guard perm="group.read"><MorningDashboard request={api} canViewArrivals={true} onTasks={()=>{window.location.href='/tasks/';}}/></Guard>;}
