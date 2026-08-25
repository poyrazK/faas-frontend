import { redirect } from 'next/navigation';

export default async function WorkflowSlugRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/dashboard/services/${slug}`);
}
