import { redirect } from 'next/navigation';

export default function MenuRedirectPage() {
  redirect('/bar/menu');
}
