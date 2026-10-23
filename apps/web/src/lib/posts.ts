import { z } from 'astro/zod';

// Essays and field notes (content.md, "Content model"; roadmap.md, PR 5). This module is pure: the
// collections' schemas and every rule about what a build writes. The build reads the posts through
// lib/content.ts and asks this module what to render; the unit tests ask it the same questions with
// posts of their own, so a rule is tested once, with known answers, and trusted everywhere else.

/** The fixed tag list (content.md): adding a tag is a pull request. There are no tag pages. */
export const TAGS = [
  'architecture',
  'data',
  'go',
  'cloudflare',
  'durable-objects',
  'platform',
  'testing',
  'security',
  'tools',
  'writing',
] as const;

/** Writing renders at this many published posts, essays and notes together (content.md, "Sitemap
 *  and phases"). Below it nothing renders: no page, no link, no feed. */
export const MIN_POSTS = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** A calendar day at midnight UTC, or null. YAML reads an unquoted 2026-10-23 as that Date; a quoted
 *  one arrives as the string. A time of day or an offset is refused, because an offset names a time
 *  zone, the same reason commits are made in UTC (AGENTS.md). */
export function asDay(value: Date | string): Date | null {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  if (Number.isNaN(date.getTime()) || date.getTime() % MS_PER_DAY !== 0) return null;
  // A string must be a real day: Date rolls 2026-02-30 over to March 2.
  if (typeof value === 'string' && (!DAY.test(value) || date.toISOString().slice(0, 10) !== value))
    return null;
  return date;
}

const day = z
  .union([z.date(), z.string()])
  .refine((value) => asDay(value) !== null, 'a calendar day, YYYY-MM-DD, with no time or offset')
  .transform((value) => asDay(value) as Date);

const post = {
  title: z.string().min(1).max(70),
  summary: z.string().min(1).max(160), // the meta description, og:description and the feed's
  published: day,
  updated: day.optional(),
  draft: z.boolean().default(false),
  tags: z
    .array(z.enum(TAGS))
    .max(3)
    .default([])
    .refine((tags) => new Set(tags).size === tags.length, 'each tag once'),
  firewall_reviewed: day, // set by hand after the human review
};

const updatedAfterPublished = (data: { published: Date; updated?: Date | undefined }) =>
  data.updated === undefined || data.updated.getTime() >= data.published.getTime();
const UPDATED = { message: 'updated comes on or after published', path: ['updated'] };

/** Front matter of an essay, src/content/writing/<slug>.md. Strict: an unknown key fails the build,
 *  and there is no slug field, because the file name is the slug. */
export const essaySchema = z
  .strictObject({ ...post, kind: z.enum(['essay', 'pattern', 'postmortem']) })
  .refine(updatedAfterPublished, UPDATED);

/** Front matter of a field note, src/content/notes/<slug>.md. A source, when given, is https. */
export const noteSchema = z
  .strictObject({ ...post, source: z.url({ protocol: /^https$/ }).optional() })
  .refine(updatedAfterPublished, UPDATED);

export type EssayData = z.infer<typeof essaySchema>;
export type NoteData = z.infer<typeof noteSchema>;
export type Tag = (typeof TAGS)[number];

/** The two collections, which are also the URL prefixes (ADR 0005). */
export type Section = 'writing' | 'notes';

/** One post, essay or note, as every page, the feed and the JSON-LD read it. */
export interface Post {
  readonly section: Section;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly published: Date;
  readonly updated: Date | null;
  readonly draft: boolean;
  readonly tags: readonly Tag[];
  readonly kind: EssayData['kind'] | 'note';
  /** A note's source link, if it has one. */
  readonly source: string | null;
}

export const fromEssay = (slug: string, data: EssayData): Post => ({
  section: 'writing',
  slug,
  title: data.title,
  summary: data.summary,
  published: data.published,
  updated: data.updated ?? null,
  draft: data.draft,
  tags: data.tags,
  kind: data.kind,
  source: null,
});

export const fromNote = (slug: string, data: NoteData): Post => ({
  section: 'notes',
  slug,
  title: data.title,
  summary: data.summary,
  published: data.published,
  updated: data.updated ?? null,
  draft: data.draft,
  tags: data.tags,
  kind: 'note',
  source: data.source ?? null,
});

/** A slug is the file name: lowercase ASCII words joined by hyphens (content.md, "URL scheme"). */
export const isSlug = (name: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);

/** Where the post collections are read from. A production build always reads src/content. Only
 *  scripts/build-fixtures.mjs names a fixture set, through POST_FIXTURES, and test/writing.test.ts
 *  fails if a fixture ever reaches the real build. */
export function postsBase(fixtureSet: string | undefined): string {
  if (fixtureSet === undefined || fixtureSet === '') return './src/content';
  if (!/^[a-z]+$/.test(fixtureSet))
    throw new Error(`POST_FIXTURES: not a fixture set: ${fixtureSet}`);
  return `./test/fixtures/posts/${fixtureSet}`;
}

/**
 * Whether this build writes drafts: astro dev always, a build only with DRAFTS=include. CI sets
 * that for pull requests alone, so previews show drafts and production never does (content.md,
 * "Drafts"). Any other value, or none, is a production build: the safe default.
 */
export function draftsIncluded(
  env: { readonly DRAFTS?: string | undefined },
  dev: boolean,
): boolean {
  return dev || env.DRAFTS === 'include';
}

/** Newest first; a day's posts by slug, so the order never depends on the file system. */
export function newestFirst(posts: readonly Post[]): Post[] {
  return [...posts].sort(
    (a, b) => b.published.getTime() - a.published.getTime() || a.slug.localeCompare(b.slug),
  );
}

/** What a build writes for Writing, decided once from the posts and whether drafts are included. */
export interface WritingArea {
  /** Published posts, newest first. */
  readonly published: readonly Post[];
  /** Writing renders: /writing/, its header link, Home's row, /rss.xml and the feed link. */
  readonly visible: boolean;
  /** The section indexes this build writes: /writing/, and /notes/ once a note is published. */
  readonly sections: readonly Section[];
  /** The posts this build writes a page for: the published ones while Writing renders, and every
   *  draft when drafts are included. A draft is listed nowhere: not in an index, on Home, in the
   *  feed or in the sitemap, and it does not count toward MIN_POSTS. */
  readonly pages: readonly Post[];
}

export function writingArea(posts: readonly Post[], includeDrafts: boolean): WritingArea {
  const published = newestFirst(posts.filter((p) => !p.draft));
  const drafts = includeDrafts ? newestFirst(posts.filter((p) => p.draft)) : [];
  const visible = published.length >= MIN_POSTS;
  const sections: Section[] = visible
    ? ['writing', ...(published.some((p) => p.section === 'notes') ? (['notes'] as const) : [])]
    : [];
  return { published, visible, sections, pages: [...(visible ? published : []), ...drafts] };
}

/** A post's page URL (ADR 0005): its section, then its slug, with the trailing slash. */
export const postPath = (post: Pick<Post, 'section' | 'slug'>): string =>
  `/${post.section}/${post.slug}/`;

/** The URLs Writing adds to a build, for the nav manifest (lib/nav.ts): the indexes and the feed. */
export function areaRoutes(area: WritingArea): string[] {
  return [...area.sections.map((section) => `/${section}/`), ...(area.visible ? ['/rss.xml'] : [])];
}

/** The posts an index lists: everything on /writing/, notes alone on /notes/. */
export const listedOn = (area: WritingArea, section: Section): readonly Post[] =>
  section === 'writing' ? area.published : area.published.filter((p) => p.section === 'notes');

/** The words a section and a kind go by. */
export const SECTION_LABELS: Readonly<Record<Section, string>> = {
  writing: 'Writing',
  notes: 'Field notes',
};
export const KIND_LABELS: Readonly<Record<Post['kind'], string>> = {
  essay: 'Essay',
  pattern: 'Pattern',
  postmortem: 'Postmortem',
  note: 'Field note',
};

/** A day as the site writes it: YYYY-MM-DD, the form the telemetry strip uses. */
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** One item of /rss.xml, in the shape @astrojs/rss takes. */
export interface FeedItem {
  readonly title: string;
  readonly link: string;
  readonly pubDate: Date;
  readonly description: string;
  readonly categories: string[];
}

/** The feed's items: published posts only, newest first, each linking to its page. */
export function feedItems(area: WritingArea): FeedItem[] {
  if (!area.visible) return [];
  return area.published.map((post) => ({
    title: post.title,
    link: postPath(post),
    pubDate: post.published,
    description: asHtml(post.summary),
    categories: [...post.tags],
  }));
}

/** RSS 2.0's description is HTML, and a summary is plain text, so a "<" in it must reach a reader
 *  as "&lt;". The XML builder then escapes the result again, for XML. Without this step the W3C
 *  validator warns "Invalid HTML", and a reader may drop the text after the "<". */
export const asHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
