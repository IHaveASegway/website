import { labCards, labPath, type LabArea } from './lab';
import { KIND_LABELS, postPath, type Post, type Section, type WritingArea } from './posts';
import type { ProjectCard } from './profile';

// Selected work on Home (content.md, "Home page", row 4, and "Owned work"). A card opens a page: a
// demo in the lab, a project's repository, or a post on this site. The rule every card meets is that its page exists
// in this build: a card never links to nothing, and a card with nowhere to go is not drawn. When no
// card has a target, Home has no Selected work section at all.

/** A card as WorkCard.astro renders it. */
export interface WorkCard {
  readonly title: string;
  readonly text: string;
  readonly tag?: string;
  readonly facts: readonly { readonly term: string; readonly value: string }[];
  readonly link: { readonly href: string; readonly label: string; readonly external: boolean };
}

/** A post with a card of its own in Selected work. The card's words are the post's own title,
 *  summary and kind, so the post's front matter stays their one owner; this names which post, and
 *  the words of the card's link. */
export interface FeaturedPost {
  readonly section: Section;
  readonly slug: string;
  readonly label: string;
}

/** The posts Selected work features, in order: none since 2026-10-29 (ADR 0023). The auto-trader
 *  teardown had a card here, and with the one post a card, Home's Writing section held two links
 *  and nothing else; a post is listed under Writing, with its date and kind, as the personal sites
 *  Home follows list theirs. The machinery stays, tested, for a post that earns a card of its own:
 *  a card links to it on this site, never to a repository. */
export const FEATURED_POSTS: readonly FeaturedPost[] = [];

/** A card for each featured post that is published in this build; a draft, or a post that does not
 *  exist, gets none. */
export function postCards(
  featured: readonly FeaturedPost[],
  published: readonly Post[],
): WorkCard[] {
  return featured.flatMap(({ section, slug, label }) => {
    const post = published.find((p) => p.section === section && p.slug === slug && !p.draft);
    if (post === undefined) return [];
    return [
      {
        title: post.title,
        text: post.summary,
        tag: KIND_LABELS[post.kind],
        facts: [],
        link: { href: postPath(post), label, external: false },
      },
    ];
  });
}

/** The cards whose link names a target this build vouches for, in their order: the rule every
 *  card meets, whatever made it. */
export function withTargets(cards: readonly WorkCard[], targets: ReadonlySet<string>): WorkCard[] {
  return cards.filter((card) => targets.has(card.link.href));
}

/**
 * Home's Selected work: the lab's demos, then the project cards, then the featured posts. The
 * targets are the demo pages and post pages this build lists, and the repositories of the projects
 * projectCards() returned, which are the records whose check is recorded and whose hold is lifted
 * (lib/profile.ts). A preview's draft page is no target: nothing but a draft may link a draft.
 */
export function selectedWork(
  projects: readonly ProjectCard[],
  area: WritingArea,
  lab: LabArea,
): WorkCard[] {
  const targets = new Set([
    ...lab.entries.map(labPath),
    ...area.pages.filter((page) => page.exposure === 'listed').map((page) => postPath(page.post)),
    ...projects.map((project) => project.link.href),
  ]);
  return withTargets(
    [...labCards(lab), ...projects, ...postCards(FEATURED_POSTS, area.published)],
    targets,
  );
}

/** Home's Writing row: the latest published posts, newest first, less any post Selected work
 *  already shows as a card, so one page never lists a post twice (content.md, "Home page"). */
export function writingRow(
  published: readonly Post[],
  cards: readonly WorkCard[],
  count = 3,
): Post[] {
  const shown = new Set(cards.map((card) => card.link.href));
  return published.filter((post) => !shown.has(postPath(post))).slice(0, count);
}

/** The demos Home features, in the order its page tells them (ADR 0024): the Route Lab's day is
 *  the scene under Joseph's name, so its chapter comes first, then the Raft Lab's cluster. */
export const FEATURED_DEMOS: readonly string[] = ['/lab/routes/', '/lab/raft/'];

/** Selected work as Home lays it out: the featured demos first, in FEATURED_DEMOS order, then
 *  every other card in the list's own order. The same cards as the list, never more or fewer;
 *  only the order is Home's (test/project-cards.test.ts). */
export function featuredFirst<T extends { readonly link: { readonly href: string } }>(
  cards: readonly T[],
): T[] {
  const rank = (card: T) => {
    const k = FEATURED_DEMOS.indexOf(card.link.href);
    return k < 0 ? FEATURED_DEMOS.length : k;
  };
  return cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => rank(a.card) - rank(b.card) || a.i - b.i)
    .map(({ card }) => card);
}
