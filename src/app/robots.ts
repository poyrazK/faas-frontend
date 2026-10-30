import type { MetadataRoute } from 'next';

/** The operator console is private; keep every page out of search indexes. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
