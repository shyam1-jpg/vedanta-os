import Guard from "@/components/Guard";
import SupplierRegister from "@/components/SupplierRegister";
export default function Page() { return <Guard perm="supplier.register"><SupplierRegister /></Guard>; }
