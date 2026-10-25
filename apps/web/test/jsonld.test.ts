import { describe, expect, test } from 'vitest';
import { decodeReferences } from '../src/lib/held-names';
import { isNoindex } from '../src/lib/noindex.mjs';
import {
  AUTHOR_KEYS,
  homeGraph,
  PERSON_KEYS,
  PERSON_OPTIONAL_KEYS,
  POSTING_KEYS,
  POSTING_OPTIONAL_KEYS,
  serialize,
  WEBSITE_KEYS,
  WEBSITE_OPTIONAL_KEYS,
} from '../src/lib/jsonld';
import { checkedProfiles } from '../src/lib/profile';
import { html, profile, read } from './support/dist';

// Structured data (content.md, "Structured data and link previews"). The test is an allowlist:
// each node's keys must be exactly the listed ones, so worksFor, memberOf, address, alumniOf,
// workLocation, colleague, birthPlace, geo or any key nobody thought of cannot pass by being new.

type Node = Record<string, unknown>;

function blocks(page: string): Node[] {
  return [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    ([, json = '']) => JSON.parse(json) as Node,
  );
}

/** Keys outside the allowlist, or allowed keys that are required and missing. */
export function keyProblems(
  node: Node,
  required: readonly string[],
  optional: readonly string[] = [],
): string[] {
  const keys = Object.keys(node);
  return [
    ...keys
      .filter((k) => !required.includes(k) && !optional.includes(k))
      .map((k) => `unexpected ${k}`),
    ...required.filter((k) => !keys.includes(k)).map((k) => `missing ${k}`),
  ];
}

describe("Home's graph", () => {
  const [graph, ...rest] = blocks(read('index.html'));
  const nodes = (graph?.['@graph'] ?? []) as Node[];
  const website = nodes.find((n) => n['@type'] === 'WebSite') ?? {};
  const person = nodes.find((n) => n['@type'] === 'Person') ?? {};
  const sameAs = checkedProfiles(profile).map((p) => p.url);

  test('one block, schema.org, with exactly a WebSite and a Person', () => {
    expect(rest).toEqual([]);
    expect(Object.keys(graph ?? {}).sort()).toEqual(['@context', '@graph']);
    expect(graph?.['@context']).toBe('https://schema.org');
    expect(nodes.map((n) => n['@type'])).toEqual(['WebSite', 'Person']);
  });

  test('WebSite carries exactly its allowed keys, and its publisher is the Person', () => {
    // alternateName is the GitHub handle: present exactly when the GitHub profile is checked.
    const github = checkedProfiles(profile).some((p) => p.network === 'GitHub');
    const required = github ? [...WEBSITE_KEYS, ...WEBSITE_OPTIONAL_KEYS] : WEBSITE_KEYS;
    expect(keyProblems(website, required)).toEqual([]);
    expect(website['publisher']).toEqual({ '@id': person['@id'] });
    expect(website['url']).toBe('https://ihaveasegway.com/');
  });

  test('Person carries exactly its allowed keys; sameAs only when a profile is checked', () => {
    // With no checked profile, sameAs is not optional but absent: it counts as unexpected.
    const required = sameAs.length > 0 ? [...PERSON_KEYS, ...PERSON_OPTIONAL_KEYS] : PERSON_KEYS;
    expect(keyProblems(person, required)).toEqual([]);
    if (sameAs.length === 0) expect(person).not.toHaveProperty('sameAs');
    else expect(person['sameAs']).toEqual(sameAs);
  });

  test('the Person is the profile: its name, its title, its @id, and the country alone', () => {
    expect(person['@id']).toBe('https://ihaveasegway.com/#person');
    expect(person['name']).toBe(profile.basics.name);
    expect(person['jobTitle']).toBe(profile.basics.label);
    expect(person['homeLocation']).toEqual({ '@type': 'Country', name: 'United States' });
  });
});

/** A published post's page: /writing/<slug>/ or /notes/<slug>/, and not a draft. */
const isPost = (file: string) =>
  /^(writing|notes)\/[a-z0-9-]+\/index\.html$/.test(file) && !isNoindex(read(file));
const posts = html.filter(isPost);

test('structured data is on Home and on published posts only, so WebSite appears only at the root', () => {
  for (const file of html.filter((f) => f !== 'index.html' && !isPost(f)))
    expect(blocks(read(file)), file).toEqual([]);
});

/** The first match of a pattern in a page, with its character references decoded. */
const first = (page: string, pattern: RegExp) => decodeReferences(pattern.exec(page)?.[1] ?? '');

for (const file of posts) {
  describe(`${file}: one BlogPosting, written from the page itself`, () => {
    const page = read(file);
    const [posting, ...rest] = blocks(page);
    const node = posting ?? {};
    const updated = page.includes(' · updated <time');

    test('exactly its allowed keys, dateModified only when the post was updated', () => {
      expect(rest).toEqual([]);
      const required = updated ? [...POSTING_KEYS, ...POSTING_OPTIONAL_KEYS] : POSTING_KEYS;
      expect(keyProblems(node, required)).toEqual([]);
      expect(node['@context']).toBe('https://schema.org');
      expect(node['@type']).toBe('BlogPosting');
    });

    test("the author is Home's Person, by @id, with exactly its keys", () => {
      const author = (node['author'] ?? {}) as Node;
      expect(keyProblems(author, AUTHOR_KEYS)).toEqual([]);
      expect(author).toEqual({
        '@type': 'Person',
        '@id': 'https://ihaveasegway.com/#person',
        name: profile.basics.name,
        url: 'https://ihaveasegway.com/',
      });
    });

    test('headline, description, url, image and dates are the ones the page shows', () => {
      expect(node['headline']).toBe(first(page, /<h1[^>]*>([^<]*)<\/h1>/));
      expect(node['description']).toBe(first(page, /<meta name="description" content="([^"]*)">/));
      expect(node['url']).toBe(first(page, /<link rel="canonical" href="([^"]*)">/));
      expect(node['image']).toBe(first(page, /<meta property="og:image" content="([^"]*)">/));
      expect(node['datePublished']).toBe(first(page, /<time datetime="([^"]*)"/));
      if (updated)
        expect(node['dateModified']).toBe(first(page, / · updated <time datetime="([^"]*)"/));
    });
  });
}

test('serialize escapes "<", so no string can close the <script> element', () => {
  const out = serialize({ name: '</script><script>alert(1)</script>' });
  expect(out).not.toContain('<');
  expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
});

test('alternateName, the handle, joins only with a checked GitHub profile', () => {
  const sha = { date: '2026-10-23', sha: 'a'.repeat(40) };
  const site = (graph: Record<string, unknown>) =>
    (graph['@graph'] as Node[]).find((n) => n['@type'] === 'WebSite') ?? {};
  const github = { network: 'GitHub' as const, url: 'https://github.com/IHaveASegway' as const };
  const withGithub = (record: typeof github & { checked?: typeof sha }) => ({
    ...profile,
    basics: { ...profile.basics, profiles: [record] },
  });
  expect(site(homeGraph(withGithub(github)))).not.toHaveProperty('alternateName');
  expect(site(homeGraph(withGithub({ ...github, checked: sha })))['alternateName']).toBe(
    'IHaveASegway',
  );
});

test('known answers: a key off the allowlist is caught, and so is a missing one', () => {
  expect(keyProblems({ '@type': 'Person', worksFor: {} }, ['@type'])).toEqual([
    'unexpected worksFor',
  ]);
  expect(keyProblems({}, ['@type'])).toEqual(['missing @type']);
});
