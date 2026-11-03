import type { Profile } from './profile';

// The résumé, /about/ on paper (content.md, "Résumé"; at /resume/ until 2026-10-28, which now
// answers with a 301): the public edition, generated from profile.json and from what this build
// already renders, never redacted from a file that held more. This module is pure: the page asks it
// what to draw, and test/resume.test.ts asks it the same questions with inputs of its own. Every
// section renders only when its source exists: the roles once Joseph adds them (Q8), Selected work
// and Writing exactly as Home has them.

type Role = Profile['work'][number];

/** A role's years as the page writes them: "2019–2024", "Since 2021" while it is current, and
 *  "2021" for a role that began and ended in one year. */
export function roleYears(role: Pick<Role, 'startDate' | 'endDate'>): string {
  if (role.endDate === undefined) return `Since ${role.startDate}`;
  if (role.endDate === role.startDate) return role.startDate;
  return `${role.startDate}–${role.endDate}`;
}

/** A link's address as text, so it reads the same on paper: "linkedin.com/in/someone",
 *  "ihaveasegway.com". The scheme, a leading www. and a trailing slash say nothing to a reader. */
export function addressText(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}
