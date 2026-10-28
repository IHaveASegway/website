import { isoDay, postPath, type Post } from './posts';
import { checkedProfiles, COUNTRY_NAMES, type Profile } from './profile';
import { ALTERNATE_NAME } from './site';

// Structured data for Home, the résumé and each published post (content.md, "Structured data and
// link previews"), built from profile.json and the post's front matter so it cannot disagree with
// the page. Each node is written from an exact list of keys, never by copying the profile: a new
// key takes a code change here, and test/jsonld.test.ts fails on any key outside these lists.
// That is an allowlist, not a denylist: worksFor, memberOf, address and their cousins cannot
// appear, named or not.

export const WEBSITE_KEYS = ['@type', '@id', 'name', 'url', 'publisher'] as const;
/** alternateName joins the WebSite only when the GitHub profile's readiness check is recorded. */
export const WEBSITE_OPTIONAL_KEYS = ['alternateName'] as const;
export const PERSON_KEYS = ['@type', '@id', 'name', 'jobTitle', 'homeLocation', 'url'] as const;
/** sameAs joins the Person only when a profile's readiness check is recorded. */
export const PERSON_OPTIONAL_KEYS = ['sameAs'] as const;
/** A published post. Google reads headline, image, the dates and the author's name and url
 *  ([Article](https://developers.google.com/search/docs/appearance/structured-data/article)). */
export const POSTING_KEYS = [
  '@context',
  '@type',
  'headline',
  'description',
  'datePublished',
  'url',
  'image',
  'author',
] as const;
/** dateModified joins only when the post says when it was updated. */
export const POSTING_OPTIONAL_KEYS = ['dateModified'] as const;
/** The author, by the same @id as Home's Person, with the name and url Google wants inline. */
export const AUTHOR_KEYS = ['@type', '@id', 'name', 'url'] as const;
/** /about/, which holds the résumé: a ProfilePage whose main entity is Home's Person, by the same @id and keys
 *  ([Profile page](https://developers.google.com/search/docs/appearance/structured-data/profile-page)). */
export const PROFILE_PAGE_KEYS = ['@context', '@type', 'url', 'mainEntity'] as const;
/** hasOccupation joins the résumé's Person only once profile.json holds a role (Q8). */
export const RESUME_PERSON_OPTIONAL_KEYS = ['sameAs', 'hasOccupation'] as const;
/** A role, in schema.org's Role pattern: the years, around the Occupation it qualifies. */
export const ROLE_KEYS = ['@type', 'startDate', 'hasOccupation'] as const;
/** endDate joins only for a role that ended. */
export const ROLE_OPTIONAL_KEYS = ['endDate'] as const;
/** An occupation is its title and nothing else: no employer, place or salary can join it. */
export const OCCUPATION_KEYS = ['@type', 'name'] as const;

/** The Person, as Home and /about/ write it. */
function personNode(profile: Profile): Record<string, unknown> {
  const { name, label, url, location } = profile.basics;
  const sameAs = checkedProfiles(profile).map((p) => p.url);
  return {
    '@type': 'Person',
    '@id': `${url}#person`,
    name,
    jobTitle: label,
    // Country only (Q5): no region, city or address exists to put here.
    homeLocation: { '@type': 'Country', name: COUNTRY_NAMES[location.countryCode] },
    url,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** Home's graph: the WebSite and the Person who publishes it. /about/ reuses the Person's @id. */
export function homeGraph(profile: Profile): Record<string, unknown> {
  const { name, url } = profile.basics;
  const personId = `${url}#person`;
  const checked = checkedProfiles(profile);
  const person = personNode(profile);
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

/** /about/'s ProfilePage: Home's Person as its main entity, with a Role per entry in profile.json's
 *  work, its title and years only. With no role, the Person is Home's exactly. */
export function profilePageGraph(profile: Profile, path: string): Record<string, unknown> {
  const roles = profile.work.map((role) => ({
    '@type': 'Role',
    startDate: role.startDate,
    ...(role.endDate === undefined ? {} : { endDate: role.endDate }),
    hasOccupation: { '@type': 'Occupation', name: role.position },
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: new URL(path, profile.basics.url).href,
    mainEntity: { ...personNode(profile), ...(roles.length > 0 ? { hasOccupation: roles } : {}) },
  };
}

/** A published post's BlogPosting. A draft carries none: it is not advertised anywhere. */
export function postingGraph(post: Post, profile: Profile, image: string): Record<string, unknown> {
  const { name, url } = profile.basics;
  const page = new URL(postPath(post), url).href;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.summary,
    datePublished: isoDay(post.published),
    ...(post.updated ? { dateModified: isoDay(post.updated) } : {}),
    url: page,
    image,
    author: { '@type': 'Person', '@id': `${url}#person`, name, url },
  };
}

/** JSON for a <script type="application/ld+json">: "<" is escaped, so no string in it can close
 *  the element. */
export function serialize(graph: Record<string, unknown>): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}
