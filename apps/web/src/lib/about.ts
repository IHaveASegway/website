import { z } from 'astro/zod';
import { asDay } from './posts';

// /about/ (content.md, "Sitemap and phases"): the bio, one Markdown entry, src/content/about.md.
// Its words are Joseph's, so the page is built only once he turns `draft` off; until then a build
// with drafts (a pull request's preview) shows it, marked noindex, and production does not. Once
// it is built, Résumé leaves the header for it (lib/nav.ts, navFor), and the bio links the résumé.
// This module is pure, so the unit tests ask it what the page asks.

const day = z
  .union([z.date(), z.string()])
  .refine((value) => asDay(value) !== null, 'a calendar day, YYYY-MM-DD, with no time or offset')
  .transform((value) => asDay(value) as Date);

export const aboutSchema = z.strictObject({
  title: z.string().min(1).max(70),
  lead: z.string().min(1).max(160),
  description: z.string().min(1).max(160),
  draft: z.boolean(),
  firewall_reviewed: day,
});

export type About = z.infer<typeof aboutSchema>;

/** Whether this build writes /about/: the entry exists, and it is no draft or drafts are in. */
export const aboutBuilt = (about: Pick<About, 'draft'> | null, drafts: boolean): boolean =>
  about !== null && (!about.draft || drafts);

/** The URLs /about/ adds to the nav (lib/nav.ts): only once it is published. A draft in a preview
 *  is built but linked from nowhere, as a draft post is, so the preview build still holds every
 *  production page byte for byte (ADR 0015). */
export const aboutRoutes = (about: Pick<About, 'draft'> | null): string[] =>
  about !== null && !about.draft ? ['/about/'] : [];
