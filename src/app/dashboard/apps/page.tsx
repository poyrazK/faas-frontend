import { redirect } from 'next/navigation';

/** Apps were renamed "Workflows" in the console; keep old links working. */
export default function AppsRedirect(): never {
  redirect('/dashboard/services');
}
