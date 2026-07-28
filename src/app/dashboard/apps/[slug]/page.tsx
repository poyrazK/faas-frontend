import { redirect } from 'next/navigation';

/** Apps were renamed "Workflows" in the console; keep old deep links working. */
export default async function AppRedirect({ params }: { params: Promise<{ slug: string }> }): Promise<never> {
  const { slug } = await params;
  redirect(`/dashboard/workflows/${slug}`);
}
