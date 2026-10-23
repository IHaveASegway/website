import { checkedProfiles, COUNTRY_NAMES, type Profile } from './profile';
import { ALTERNATE_NAME } from './site';

// Structured data for Home (content.md, "Structured data and link previews"), built from
// profile.json so it cannot disagree with the page. Each node is written from an exact list of
// keys, never by copying the profile: a new key takes a code change here, and
// test/jsonld.test.ts fails on any key outside these lists. That is an allowlist, not a denylist:
// worksFor, memberOf, address and their cousins cannot appear, named or not.

export const WEBSITE_KEYS = ['@type', '@id', 'name', 'url', 'publisher'] as const;
/** alternateName joins the WebSite only when the GitHub profile's readiness check is recorded. */
export const WEBSITE_OPTIONAL_KEYS = ['alternateName'] as const;
export const PERSON_KEYS = ['@type', '@id', 'name', 'jobTitle', 'homeLocation', 'url'] as const;
/** sameAs joins the Person only when a profile's readiness check is recorded. */
export const PERSON_OPTIONAL_KEYS = ['sameAs'] as const;

/** Home's graph: the WebSite and the Person who publishes it. /about/ reuses the Person's @id. */
export function homeGraph(profile: Profile): Record<string, unknown> {
  const { name, label, url, location } = profile.basics;
  const personId = `${url}#person`;
  const checked = checkedProfiles(profile);
  const sameAs = checked.map((p) => p.url);
  const person: Record<string, unknown> = {
    '@type': 'Person',
    '@id': personId,
    name,
    jobTitle: label,
    // Country only (Q5): no region, city or address exists to put here.
    homeLocation: { '@type': 'Country', name: COUNTRY_NAMES[location.countryCode] },
    url,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
  // "IHaveASegway" is the GitHub handle in its exact capitals, so it names the account the way a
  // link would. It waits for the same readiness check as the GitHub link (content.md, "Repo
  // readiness checklist"); the lowercase domain names nothing beyond the site.
  const github = checked.some((p) => p.network === 'GitHub');
  const website: Record<string, unknown> = {
    '@type': 'WebSite',
    '@id': `${url}#website`,
    name,
    ...(github ? { alternateName: ALTERNATE_NAME } : {}),
    url,
    publisher: { '@id': personId },
  };
  return { '@context': 'https://schema.org', '@graph': [website, person] };
}

/** JSON for a <script type="application/ld+json">: "<" is escaped, so no string in it can close
 *  the element. */
export function serialize(graph: Record<string, unknown>): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}
