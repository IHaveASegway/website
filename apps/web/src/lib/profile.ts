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

/** The terms a card's figures may use: things a reader can check in the repository (content.md,
 *  "Owned work"). A new term is a reviewed code change, so a figure cannot slip in under any name. */
export const FACT_TERMS = [
  'Tests',
  'Decisions',
  'Releases',
  'Commands',
  'Code',
  'Benchmark',
  'Validation',
  'Signing',
  'CI',
  'License',
] as const;

/** Words that count adoption, which says nothing a reader can check about the work: refused
 *  anywhere on a card, its line, its tag and its figures. content.md names the same words. A list
 *  cannot catch every phrasing, so review still reads the card. */
export const ADOPTION_WORDS = [
  'stars',
  'starred',
  'stargazers',
  'downloads',
  'downloaded',
  'forks',
  'forked',
  'installs',
  'installed',
  'clones',
  'cloned',
  'watchers',
  'dependents',
  'users',
  'used by',
  '★',
  '⭐',
] as const;
const ADOPTION = new RegExp(
  ADOPTION_WORDS.map((w) => (/^\p{L}/u.test(w) ? `\\b${w.replace(' ', '\\s+')}\\b` : w)).join('|'),
  'iu',
);

/** The adoption word a card's text holds, or null. */
export function adoptionWord(text: string): string | null {
  return ADOPTION.exec(text)?.[0] ?? null;
}

const fact = z.strictObject({ term: z.enum(FACT_TERMS), value: z.string().min(1).max(48) });

/** A year, YYYY: the only precision a role's dates take. JSON Resume's dates allow a year alone. */
const year = z.string().regex(/^(19|20)\d{2}$/, 'a year, YYYY');

/** One role: its title and its years, with no end year while it is current. */
const role = z
  .strictObject({ position: z.string().min(1).max(60), startDate: year, endDate: year.optional() })
  .refine((r) => r.endDate === undefined || r.endDate >= r.startDate, {
    message: 'endDate comes on or after startDate',
    path: ['endDate'],
  });

/** A page on this site, as its URL path: "/lab/routes/". Home is not evidence of anything. */
const sitePage = z
  .string()
  .regex(/^\/([a-z0-9-]+\/)+$/, 'a page on this site, such as /lab/routes/');

/** One skill, and the pages on this site that show it: one to three. */
const skill = z.strictObject({
  name: z.string().min(1).max(40),
  evidence: z.array(sitePage).min(1).max(3),
});

/** What a card shows besides its name and link: its line, its tag and its figures. */
const cardWords = (p: {
  description: string;
  tag?: string | undefined;
  facts?: readonly { term: string; value: string }[] | undefined;
}): string =>
  [p.description, p.tag ?? '', ...(p.facts ?? []).flatMap((f) => [f.term, f.value])].join('\n');

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
  // Experience (Q8 (a)): role titles and years, at most 10 roles, and nothing else. JSON Resume's
  // work entry also has name (the employer), location, url, summary and highlights; none exists
  // here, so an employer, a city or a metric cannot be entered at all. Role years are ASK
  // (content.md, "Firewall classes for copy") until Joseph clears them in writing: only he adds an
  // entry, and the review stamp on this file holds the pull request to his read.
  work: z.array(role).max(10),
  // Empty until Joseph clears one in writing: an institution can name a region. A tuple of no
  // items turns any entry into a schema change.
  education: z.tuple([]),
  // Skills, each with the pages on this site that show it: /resume/ draws a skill only when every
  // page it names exists in the build (lib/resume.ts), so a skill with nothing to show is left
  // out. JSON Resume's skill also has level and keywords; neither is here.
  skills: z
    .array(skill)
    .max(12)
    .refine((all) => new Set(all.map((s) => s.name)).size === all.length, 'each skill once'),
  // Owned work (content.md): each project is a card on Home that links to its repository, once its
  // check is recorded and its hold is lifted. The tag and the facts join in the pull request that
  // turns the card on. profile.json is the one owner of a card's figures, copied by hand from the
  // repository, and `measured` is their one age: the day they were read.
  projects: z.array(
    z
      .strictObject({
        name: z.string().min(1),
        description: z.string().min(1),
        url: z.string().regex(new RegExp(`^https://github\\.com/${HANDLE}/[a-z0-9-]+$`)),
        tag: z.string().min(1).max(16).optional(),
        facts: z.array(fact).max(3).optional(),
        measured: isoDate.optional(),
        checked: githubCheck.optional(),
      })
      .refine((p) => adoptionWord(cardWords(p)) === null, {
        message: 'a card never counts adoption (content.md, "Owned work")',
        path: ['facts'],
      })
      .refine((p) => (p.facts ?? []).length === 0 || p.measured !== undefined, {
        message: 'figures need `measured`, the day they were read',
        path: ['measured'],
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

/** "Remote, US": the location line, country only, in words with no middle dot (ADR 0025). */
export function locationLine(profile: Profile): string {
  const { countryCode, remote } = profile.basics.location;
  return remote ? `Remote, ${countryCode}` : countryCode;
}

/** "Senior Software Engineer. Remote, US.": the line under Home's name, two sentences in words
 *  rather than two fields between dots (ADR 0025). */
export function roleLine(profile: Profile): string {
  return `${profile.basics.label}. ${locationLine(profile)}.`;
}

/** "Joseph Peterson, Senior Software Engineer. Remote, US.": Home's description, for search
 *  results and link previews, and the summary line of /llms.txt. */
export function homeDescription(profile: Profile): string {
  return `${profile.basics.name}, ${roleLine(profile)}`;
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

/** Test builds only. A fixture adds projects, roles and skills to the real profile's, and can
 *  record the GitHub profile's check, which a project card needs; every other field stays the real
 *  one, so a fixture build cannot drift from profile.json. Only scripts/build-fixtures.mjs names a fixture, through
 *  PROFILE_FIXTURE; every real build reads src/content/profile.json alone (test/profile.test.ts). */
export interface ProfileFixture {
  readonly githubChecked?: unknown;
  readonly projects?: readonly unknown[];
  readonly work?: readonly unknown[];
  readonly skills?: readonly unknown[];
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
  const list = (key: string): unknown[] => (Array.isArray(data[key]) ? data[key] : []);
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
    projects: [...list('projects'), ...(fixture.projects ?? [])],
    work: [...list('work'), ...(fixture.work ?? [])],
    skills: [...list('skills'), ...(fixture.skills ?? [])],
  };
}
