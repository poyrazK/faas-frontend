import React from 'react';
import Link from 'next/link';
import { opsHref } from '@/lib/routes';

/** Where frontend_hosting_enabled and the other hosting switches are set. */
export function ConfigurationLink() {
  return (
    <Link href={opsHref('configuration')} className="btn btn-secondary btn-sm">
      Runtime configuration
    </Link>
  );
}
