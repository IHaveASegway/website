import { z } from 'astro/zod';
import { asDay } from './posts';
import type { WorkCard } from './work';

// The lab (content.md, "Content model"; lab.md): demos with a write-up, one Markdown entry each in
// src/content/lab/, at /lab/<slug>/. This module is pure: the collection's schema and every rule
// about what a build writes for the lab, so the unit tests ask it the same questions the pages do.

const day = z
  .union([z.date(), z.string()])
  .refine((value) => asDay(value) !== null, 'a calendar day, YYYY-MM-DD, with no time or offset')
  .transform((value) => asDay(value) as Date);

/**
 * Where a demo runs. A browser demo is static files only: no Worker, no Durable Object, no
 * recording or time limit to declare (ADR 0016). A demo on the lab Worker (ADR 0009) declares the
 * recording it falls back to and how long its state lives, at most 15 minutes (lab.md).
 */
const runtime = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('browser') }),
  z.strictObject({
    kind: z.literal('lab-worker'),
    recording: z.string().min(1),
    ttl_minutes: z.number().int().min(1).max(15),
  }),
]);

/** Front matter of a lab entry, src/content/lab/<slug>.md. Strict, with no slug field: the file
 *  name is the slug. `lifecycle` is the publish switch, and "live" is its one value until a demo
 *  needs another (content.md lists building and retired); a new value is a schema change, made
 *  with the behavior it brings. */
export const labSchema = z.strictObject({
  title: z.string().min(1).max(70),
  summary: z.string().min(1).max(160),
  lifecycle: z.literal('live'),
  runtime,
  decisions: z.array(z.string().regex(/^\d{4}$/)).default([]),
  firewall_reviewed: day,
});

export type LabData = z.infer<typeof labSchema>;

/** One demo, as the pages read it. */
export interface LabEntry {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly decisions: readonly string[];
}

export const fromLab = (slug: string, data: LabData): LabEntry => ({
  slug,
  title: data.title,
  summary: data.summary,
  decisions: data.decisions,
});

/** The demos with a page file of their own under src/pages/lab/, which [demo].astro leaves out,
 *  so neither demo's page links the other's styles or code. */
export const OWN_PAGE: ReadonlySet<string> = new Set(['raft', 'queue']);

/** A lab entry's page URL (ADR 0005). `api` is never a slug: the lab Worker owns /lab/api/. */
export const labPath = (entry: Pick<LabEntry, 'slug'>): string => `/lab/${entry.slug}/`;

/** What a build writes for the lab: every live demo, by slug, and /lab/ while there is one. */
export interface LabArea {
  readonly entries: readonly LabEntry[];
  readonly visible: boolean;
}

export function labArea(entries: readonly LabEntry[]): LabArea {
  if (entries.some((entry) => entry.slug === 'api'))
    throw new Error('lab: "api" is reserved for the lab Worker (ADR 0009)');
  const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug));
  return { entries: sorted, visible: sorted.length > 0 };
}

/** The URLs the lab adds to a build, for the nav manifest (lib/nav.ts) and llms.txt. */
export const labRoutes = (area: LabArea): string[] =>
  area.visible ? ['/lab/', ...area.entries.map(labPath)] : [];

/** Home's card for each demo, before the project cards (lib/work.ts, selectedWork). */
export const labCards = (area: LabArea): WorkCard[] =>
  area.entries.map((entry) => ({
    title: entry.title,
    text: entry.summary,
    tag: 'Lab',
    facts: [],
    link: { href: labPath(entry), label: 'Try it', external: false },
  }));
