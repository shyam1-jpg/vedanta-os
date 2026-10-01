import Guard from '@/components/Guard';import AssetLibrary from '@/components/AssetLibrary';
export default function Page(){return <Guard perm="maintenance.read"><AssetLibrary/></Guard>;}
