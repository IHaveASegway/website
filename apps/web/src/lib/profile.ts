import { z } from 'astro/zod';

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
  projects: z.array(
    z.strictObject({
      name: z.string().min(1),
      description: z.string().min(1),
      url: z.string().regex(new RegExp(`^https://github\\.com/${HANDLE}/[a-z0-9-]+$`)),
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
