import Guard from '@/components/Guard';import GuestNeedsReviews from '@/components/GuestNeedsReviews';export default function Page(){return <Guard perm="guest.read"><GuestNeedsReviews/></Guard>;}
