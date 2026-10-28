import { z } from 'astro/zod';
import { asDay } from './posts';

// /about/ (content.md, "About"): who Joseph is and how he works, then his résumé. Two sources, one
// owner each: src/content/about.md holds the bio, his words, and profile.json holds every fact the
// résumé shows (lib/resume.ts). The page is built by every build, as the résumé it replaced was
// (2026-10-28; /resume/ now answers with a 301 to it, public/_redirects); the bio renders only
// where its entry exists, so the fixture builds, which hold none, still draw the résumé. The entry
// carries no title, lead or description: the nav names the page, and the profile states the facts.

const day = z
  .union([z.date(), z.string()])
  .refine((value) => asDay(value) !== null, 'a calendar day, YYYY-MM-DD, with no time or offset')
  .transform((value) => asDay(value) as Date);

export const aboutSchema = z.strictObject({
  firewall_reviewed: day,
});

export type About = z.infer<typeof aboutSchema>;

/** The page's URL. It replaced /resume/ on 2026-10-28 (ADR 0005: a move keeps the old URL in the
 *  ledger and gives it a 301). */
export const ABOUT_PATH = '/about/';
