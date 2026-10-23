import { z } from 'astro/zod';
import { findHeld, type Hold } from './held-names';

// The public profile (content.md, "Content model"): a JSON Resume subset, read from
// src/content/profile.json and validated when the site builds (schema-on-write). It is the one
// owner of the name, the title, the location line and the external links: every page, the
// Open Graph image and the JSON-LD read them from here.
//
// Every object is strict, so a field the schema does not name fails the build. There is no slot
// for an employer, a city, a region, an address, an email or a phone number: illegal states are
// unrepresentable rather than merely checked.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const commit = z.string().regex(/^[0-9a-f]{40}$/, 'a full 40-character commit SHA');

/** The GitHub account the site's name matches. Naming one of its repositories works like linking
 *  it, so a repository's name is held off the site too until its check passes (not-on-site.txt). */
export const HANDLE = 'IHaveASegway';

/**
 * A readiness check that passed (content.md, "Repo readiness checklist"). A record renders
 * nowhere until it carries one: its link, its name in a link, JSON-LD sameAs, rel="me". A GitHub
 * record also names the commit the check read; a profile elsewhere has no commit, only a date.
 */
const githubCheck = z.strictObject({ date: isoDate, sha: commit });
const profileCheck = z.strictObject({ date: isoDate });

/** A figure on a project's card: static, re-measured when the card is turned on, and never an
 *  adoption count (content.md, "Owned work"), which says nothing a reader can check about the work. */
const ADOPTION = /\b(stars?|stargazers?|downloads?|forks?|installs?|clones?|watchers?)\b/i;
const fact = z
  .strictObject({ term: z.string().min(1).max(24), value: z.string().min(1).max(48) })
  .refine(({ term, value }) => !ADOPTION.test(`${term} ${value}`), 'never an adoption count');

/** Country names for JSON-LD homeLocation. Adding a country is a code change, reviewed like one. */
export const COUNTRY_NAMES = { US: 'United States' } as const;

export const profileSchema = z.strictObject({
  basics: z.strictObject({
    name: z.string().min(1),
    label: z.string().min(1), // the title line (Q4)
    url: z.literal('https://ihaveasegway.com/'),
    // Country only (Q5): a region, a city or an address cannot be entered at all.
    location: z.strictObject({ countryCode: z.enum(['US']), remote: z.boolean() }),
    profiles: z.array(
      z.discriminatedUnion('network', [
        z.strictObject({
          network: z.literal('GitHub'),
          url: z.literal(`https://github.com/${HANDLE}`),
          checked: githubCheck.optional(),
        }),
        z.strictObject({
          network: z.literal('LinkedIn'),
          url: z.string().regex(/^https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+\/$/),
          checked: profileCheck.optional(),
        }),
      ]),
    ),
  }),
  // Empty until Joseph clears them in writing: role years are ASK (content.md, "Firewall classes
  // for copy"), an institution can name a region, and the stack line waits on his list. A tuple of
  // no items turns any entry into a schema change.
  work: z.tuple([]),
  education: z.tuple([]),
  skills: z.tuple([]),
  // Owned work (content.md): each project is a card on Home that links to its repository, once its
  // check is recorded and its hold is lifted. The tag and the facts join in the pull request that
  // turns the card on, re-measured that day.
  projects: z.array(
    z.strictObject({
      name: z.string().min(1),
      description: z.string().min(1),
      url: z.string().regex(new RegExp(`^https://github\\.com/${HANDLE}/[a-z0-9-]+$`)),
      tag: z.string().min(1).max(16).optional(),
      facts: z.array(fact).max(3).optional(),
      checked: githubCheck.optional(),
    }),
  ),
  // The date of the human firewall review, set by hand after it (content.md); null until then.
  meta: z.strictObject({ firewall_reviewed: isoDate.nullable() }),
});

export type Profile = z.infer<typeof profileSchema>;
export type ExternalProfile = Profile['basics']['profiles'][number];

/** A record renders only when its readiness check is recorded. */
export function isChecked<T extends { checked?: unknown }>(
  record: T,
): record is T & { checked: NonNullable<T['checked']> } {
  return record.checked !== undefined;
}

/** The external profiles that may render: the hero's actions, the footer, sameAs and rel="me". */
export function checkedProfiles(profile: Profile): ExternalProfile[] {
  return profile.basics.profiles.filter(isChecked);
}

/** "US · remote": the location line, country only. */
export function locationLine(profile: Profile): string {
  const { countryCode, remote } = profile.basics.location;
  return remote ? `${countryCode} · remote` : countryCode;
}

/** Every URL a record holds, checked or not, with the network it is on: the readiness test's list
 *  of what may not leak. A project is a GitHub repository. */
export function recordUrls(profile: Profile): { url: string; checked: boolean; network: string }[] {
  return [
    ...profile.basics.profiles.map((r) => ({
      url: r.url,
      checked: isChecked(r),
      network: r.network,
    })),
    ...profile.projects.map((r) => ({ url: r.url, checked: isChecked(r), network: 'GitHub' })),
  ];
}

export type Project = Profile['projects'][number];

/** A project's card on Home, as WorkCard renders it. */
export interface ProjectCard {
  readonly title: string;
  readonly text: string;
  readonly tag?: string;
  readonly facts: readonly { term: string; value: string }[];
  readonly link: { href: string; label: string; external: true };
}

/** Everything a project's card would show, the link included, as one text for the hold check. */
const cardText = (p: Project): string =>
  [
    p.name,
    p.description,
    p.url,
    p.tag ?? '',
    ...(p.facts ?? []).flatMap((f) => [f.term, f.value]),
  ].join('\n');

/**
 * The project cards Home renders, in profile order. A project shows only when its readiness check
 * is recorded, the GitHub profile's is too (a repository's page links its owner's profile, and its
 * URL names the account: "the linked GitHub profile passes too"), and no held name appears anywhere
 * on its card, its link included (not-on-site.txt). So a project turns on in reviewed steps: the
 * checks are recorded, then the hold is lifted (content.md, "Repo readiness checklist").
 */
export function projectCards(profile: Profile, holds: readonly Hold[]): ProjectCard[] {
  if (!checkedProfiles(profile).some((p) => p.network === 'GitHub')) return [];
  return profile.projects
    .filter(isChecked)
    .filter((p) => findHeld(cardText(p), holds).length === 0)
    .map((p) => ({
      title: p.name,
      text: p.description,
      ...(p.tag === undefined ? {} : { tag: p.tag }),
      facts: p.facts ?? [],
      link: { href: p.url, label: 'Source on GitHub', external: true },
    }));
}

/** Test builds only. A fixture adds projects to the real profile's, and can record the GitHub
 *  profile's check, which a project card needs; every other field stays the real one, so a fixture
 *  build cannot drift from profile.json. Only scripts/build-fixtures.mjs names a fixture, through
 *  PROFILE_FIXTURE; every real build reads src/content/profile.json alone (test/profile.test.ts). */
export interface ProfileFixture {
  readonly githubChecked?: unknown;
  readonly projects?: readonly unknown[];
}

export function projectFixturePath(fixture: string | undefined): string | null {
  if (fixture === undefined || fixture === '') return null;
  if (!/^[a-z]+$/.test(fixture)) throw new Error(`PROFILE_FIXTURE: not a fixture: ${fixture}`);
  return `test/fixtures/profile/${fixture}.json`;
}

/** profile.json's data with a fixture applied; the data itself when there is no fixture. */
export function withFixture(
  data: Record<string, unknown>,
  fixture: ProfileFixture | null,
): Record<string, unknown> {
  if (fixture === null) return data;
  const projects = Array.isArray(data['projects']) ? data['projects'] : [];
  const basics = (data['basics'] ?? {}) as Record<string, unknown>;
  const profiles = Array.isArray(basics['profiles']) ? basics['profiles'] : [];
  return {
    ...data,
    basics: {
      ...basics,
      profiles: profiles.map((r: Record<string, unknown>) =>
        r['network'] === 'GitHub' && fixture.githubChecked !== undefined
          ? { ...r, checked: fixture.githubChecked }
          : r,
      ),
    },
    projects: [...projects, ...(fixture.projects ?? [])],
  };
}
