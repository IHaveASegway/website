import { ABOUT_PATH } from './about';
import { postPath, type Post } from './posts';
import type { Profile } from './profile';
import type { WorkCard } from './work';

// The résumé, drawn on /about/ under the bio (content.md, "Résumé"; at /resume/ until 2026-10-28,
// which now answers with a 301): the public edition, generated from profile.json
// and from what this build already renders, never redacted from a file that held more. This
// module is pure: the page asks it what to draw, and test/resume.test.ts asks it the same
// questions with inputs of its own. Every section renders only when its source exists: the roles
// once Joseph adds them (Q8), a skill once every page it names is built, Selected work and Writing
// exactly as Home has them.

type Role = Profile['work'][number];
type Skill = Profile['skills'][number];

/** A role's years as the page writes them: "2019–2024", "Since 2021" while it is current, and
 *  "2021" for a role that began and ended in one year. */
export function roleYears(role: Pick<Role, 'startDate' | 'endDate'>): string {
  if (role.endDate === undefined) return `Since ${role.startDate}`;
  if (role.endDate === role.startDate) return role.startDate;
  return `${role.startDate}–${role.endDate}`;
}

/**
 * The pages a skill may name as evidence, each with the title a link to it shows: Selected work's
 * pages on this site (a demo, a featured post), the posts this build lists, and the other pages
 * it writes: the manifest's and the section indexes. Each title is the page's own (a card's, a
 * post's, a nav or section label), so the résumé adds no words of its own. Its page, /about/, is
 * not evidence of itself, and Home is no skill's.
 */
export function evidencePages(
  cards: readonly WorkCard[],
  published: readonly Post[],
  pages: readonly { readonly href: string; readonly label: string }[],
): Map<string, string> {
  const targets = new Map<string, string>();
  const add = (href: string, title: string) => {
    const page = href.startsWith('/') && href.endsWith('/') && href !== '/';
    if (page && href !== ABOUT_PATH && !targets.has(href)) targets.set(href, title);
  };
  for (const card of cards) add(card.link.href, card.title);
  for (const post of published) add(postPath(post), post.title);
  for (const page of pages) add(page.href, page.label);
  return targets;
}

/** A skill as the page draws it: its name, and a link to each page that shows it. */
export interface ShownSkill {
  readonly name: string;
  readonly evidence: readonly { readonly href: string; readonly title: string }[];
}

/** The skills the résumé draws, in profile order: those whose every evidence page this build
 *  writes. A skill that names one page the build lacks is left out whole, never shown half-proved. */
export function shownSkills(
  skills: readonly Skill[],
  targets: ReadonlyMap<string, string>,
): ShownSkill[] {
  return skills.flatMap((skill) => {
    const evidence = skill.evidence.map((href) => ({ href, title: targets.get(href) }));
    if (evidence.some((e) => e.title === undefined)) return [];
    return [{ name: skill.name, evidence: evidence as ShownSkill['evidence'] }];
  });
}

/** A link's address as text, so it reads the same on paper: "linkedin.com/in/someone",
 *  "ihaveasegway.com". The scheme, a leading www. and a trailing slash say nothing to a reader. */
export function addressText(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}
