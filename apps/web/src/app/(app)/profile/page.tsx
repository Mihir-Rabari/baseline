import { redirect } from 'next/navigation';

/** The profile now lives on the dashboard; old links and bookmarks land on its Profile tab. */
export default function ProfileRedirect() {
  redirect('/dashboard?tab=profile');
}
