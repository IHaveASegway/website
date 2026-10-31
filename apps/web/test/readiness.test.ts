import { describe, expect, test } from 'vitest';
import { normalize, readingOf, views, type Reading } from '../src/lib/held-names';
import { homeGraph } from '../src/lib/jsonld';
import { checkedProfiles, HANDLE, isChecked, recordUrls, type Profile } from '../src/lib/profile';
import { html, profile, read, textFiles } from './support/dist';

// Readiness before links (content.md, "Repo readiness checklist"; roadmap.md, PR 3). A link sends
// readers to everything a repository or profile holds, so it renders only from a record in
// profile.json whose check is recorded. This test reads every URL-shaped string in every text file
// the site serves (pages, JSON-LD, the sitemap, the license texts) and fails on any that reaches
// the GitHub account without a checked record, whatever the host: github.com, its gist, raw and
// pages hosts, or a mirror such as pkg.go.dev that carries the handle in its path. And it fails on
// any unchecked record in any spelling: with or without its scheme, www. or trailing slash, in
// any case, or a profile's slug alone.

const GITHUB_HOST =
  /(^|\.)(github\.com|githubusercontent\.com|github\.io|githubassets\.com|github\.dev|ghcr\.io|git\.io)$/i;
const OWN_HOST = /^(www\.)?ihaveasegway\.com$/i;
const HANDLE_ANY_CASE = new RegExp(HANDLE, 'i');

// The two font licenses the site must ship (public/fonts/OFL-*.txt) begin with their projects'
// copyright lines, which name the projects' own repositories. These exact URLs, in these files only,
// are the one exception: they reach no account of Joseph's.
const LICENSE_NOTICES = [
  { file: 'fonts/OFL-Barlow.txt', url: 'https://github.com/jpt/barlow' },
  { file: 'fonts/OFL-B612Mono.txt', url: 'https://github.com/polarsys/b612' },
];

/** Text as the URL checks read it: markup with its references decoded; a script in each of its
 *  views (lib/held-names.ts: as written, its string escapes decoded, and the markup it may write),
 *  one per line; then JSON's "\/" and percent-encoded slashes and colons undone, so an escaped or
 *  encoded URL is the same URL. */
function readable(text: string, reading: Reading = 'markup'): string {
  const read = reading === 'script' ? views(text, 'script').join('\n') : normalize(text);
  return read.replace(/\\\//g, '/').replace(/%2f/gi, '/').replace(/%3a/gi, ':');
}

/** Every URL-shaped string: with a scheme, protocol-relative, or a bare GitHub host and path. */
export function urlsIn(text: string, reading: Reading = 'markup'): string[] {
  const plain = readable(text, reading);
  const tidy = (url: string) => url.replace(/[.,;:!?]+$/, '');
  const full = [...plain.matchAll(/(?:https?:)?\/\/[^\s"'<>()\\]+/gi)].map(([url]) => tidy(url));
  // A bare host inside a URL already found is that URL again, not a second one.
  const bare = [
    ...plain.matchAll(
      /(?<![\w.-])(?:[a-z0-9-]+\.)*(?:github\.com|githubusercontent\.com|github\.io|githubassets\.com|github\.dev|ghcr\.io|git\.io)\b[^\s"'<>()\\]*/gi,
    ),
  ]
    .map(([url]) => tidy(url))
    .filter((url) => !full.some((f) => f.includes(url)));
  return [...new Set([...full, ...bare])];
}

function host(url: string): string {
  const absolute = url.startsWith('//')
    ? `https:${url}`
    : /^https?:/i.test(url)
      ? url
      : `https://${url}`;
  try {
    return new URL(absolute).hostname;
  } catch {
    return url;
  }
}

/** A URL as the comparison reads it: lowercase, without its scheme, a leading www. or a trailing
 *  slash. https://www.LinkedIn.com/in/x/ and linkedin.com/in/x are the same profile. */
export function canonical(url: string): string {
  return url
    .toLowerCase()
    .replace(/^(?:https?:)?\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

interface LinkRecord {
  readonly url: string;
  readonly checked: boolean;
  /** A profile's own name for the person, which gives the profile away without its host. A GitHub
   *  record has none here: its slug is the handle, which is also the domain, and the handle checks
   *  below cover it. */
  readonly slug?: string;
}

/** Every record profile.json holds, checked or not (profile.ts owns the list). */
export function recordsOf(p: Profile): LinkRecord[] {
  return recordUrls(p).map(({ url, checked, network }) => ({
    url,
    checked,
    ...(network === 'GitHub' ? {} : { slug: canonical(url).split('/').at(-1) ?? '' }),
  }));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each unchecked record a text gives away: its URL in any spelling, or a profile's slug alone. */
export function recordLeaks(
  text: string,
  records: readonly LinkRecord[],
  reading: Reading = 'markup',
): string[] {
  const plain = readable(text, reading).toLowerCase();
  return records
    .filter((record) => !record.checked)
    .flatMap((record) => {
      const forms = [canonical(record.url), ...(record.slug ? [record.slug.toLowerCase()] : [])];
      return forms
        .filter((form) =>
          new RegExp(`(?<![a-z0-9-])${escapeRegExp(form)}(?![a-z0-9-])`).test(plain),
        )
        .map((form) => `${record.url} (as ${form})`);
    });
}

const records = recordsOf(profile);
const allowed = new Set(records.filter((r) => r.checked).map((r) => canonical(r.url)));

/** Why a URL found in `file` may not ship, or null when it may. */
export function verdict(
  url: string,
  file: string,
  checked: ReadonlySet<string> = allowed,
): string | null {
  const where = host(url);
  if (OWN_HOST.test(where)) return null;
  if (checked.has(canonical(url))) return null;
  if (LICENSE_NOTICES.some((notice) => notice.file === file && notice.url === url)) return null;
  if (GITHUB_HOST.test(where)) return `a GitHub URL from no checked record: ${url}`;
  if (HANDLE_ANY_CASE.test(url)) return `the handle in a URL off the site: ${url}`;
  return null;
}

describe('every URL in dist/ that reaches the account comes from a checked record', () => {
  for (const file of textFiles) {
    test(file, () => {
      expect(
        urlsIn(read(file), readingOf(file)).flatMap((url) => verdict(url, file) ?? []),
      ).toEqual([]);
    });
  }
});

test('no record renders before its check, in any spelling: profiles and projects alike', () => {
  expect(records.length).toBeGreaterThan(0);
  const leaks = textFiles.flatMap((file) =>
    recordLeaks(read(file), records, readingOf(file)).map((leak) => `${file}: ${leak}`),
  );
  expect(leaks).toEqual([]);
});

// Scoped to GitHub records: a checked LinkedIn profile must not switch this check off.
const githubRecords = records.filter((r) => GITHUB_HOST.test(host(r.url)));
const noGithubChecked = githubRecords.every((r) => !r.checked);
test('the GitHub records exist, so the check below has something to guard', () => {
  expect(githubRecords.length).toBeGreaterThan(0);
});
test.runIf(noGithubChecked)(
  'with every GitHub record unchecked, as today, dist/ holds no GitHub URL, no handle link and no handle',
  () => {
    const found = textFiles.flatMap((file) => {
      const text = read(file);
      const urls = urlsIn(text, readingOf(file))
        .filter((url) => !LICENSE_NOTICES.some((n) => n.file === file && n.url === url))
        .filter(
          (url) =>
            GITHUB_HOST.test(host(url)) || (HANDLE_ANY_CASE.test(url) && !OWN_HOST.test(host(url))),
        )
        .map((url) => `${file}: ${url}`);
      // The handle in its own capitals is the account's name, link or not (WebSite's
      // alternateName was one); the lowercase domain is the site's.
      const handle = normalize(text, readingOf(file)).includes(HANDLE)
        ? [`${file}: the text ${HANDLE}`]
        : [];
      return [...urls, ...handle];
    });
    expect(found).toEqual([]);
  },
);

describe('rel="me", sameAs and the links agree, and each comes only from a checked profile', () => {
  const checked = new Set(checkedProfiles(profile).map((p) => p.url));

  for (const file of html) {
    test(`${file}: every rel="me" link is a checked profile`, () => {
      const me = [...read(file).matchAll(/<a\b[^>]*\brel="me"[^>]*>/g)].map(
        ([tag]) => /href="([^"]*)"/.exec(tag)?.[1],
      );
      for (const href of me) expect(checked.has(href ?? ''), href).toBe(true);
      if (file === 'index.html') expect(new Set(me)).toEqual(checked.size ? checked : new Set());
    });
  }

  test("Home's sameAs lists exactly the checked profiles, and is absent while there are none", () => {
    const json =
      /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(read('index.html'))?.[1] ?? '{}';
    const person = (JSON.parse(json)['@graph'] as Record<string, unknown>[]).find(
      (n) => n['@type'] === 'Person',
    );
    if (checked.size === 0) expect(person).not.toHaveProperty('sameAs');
    else expect(new Set(person?.['sameAs'] as string[])).toEqual(checked);
  });
});

// The gate's own functions, on a fixture that starts with every profile already checked, so each
// case must take a check away as well as add one: nothing here depends on what profile.json holds
// today. The hero, the footer and sameAs all call checkedProfiles(); the checks on dist/ above
// prove the rendered links agree with it on the real profile.
describe('the gate itself, on fixtures: a record renders exactly when it is checked', () => {
  const today = { date: '2026-10-23' };
  const sha = { date: '2026-10-23', sha: 'a'.repeat(40) };
  const linkedinUrl = 'https://www.linkedin.com/in/someone-example/';
  /** A record without its check. */
  function bare<T extends { checked?: unknown }>(record: T): Omit<T, 'checked'> {
    const copy = { ...record };
    delete copy.checked;
    return copy;
  }
  const base: Profile = {
    ...profile,
    // No project is checked here, whatever the build's profile holds (a fixture build checks one).
    projects: profile.projects.map((p) => bare(p)),
    basics: {
      ...profile.basics,
      profiles: [
        { network: 'GitHub', url: `https://github.com/${HANDLE}`, checked: sha },
        { network: 'LinkedIn', url: linkedinUrl, checked: today },
      ],
    },
  };
  const withChecks = (linkedin: boolean, github: boolean): Profile => ({
    ...base,
    basics: {
      ...base.basics,
      profiles: base.basics.profiles.map((p) => {
        if (p.network === 'LinkedIn') return linkedin ? { ...bare(p), checked: today } : bare(p);
        return github ? { ...bare(p), checked: sha } : bare(p);
      }),
    },
  });
  const site = (p: Profile) => (homeGraph(p)['@graph'] as Record<string, unknown>[])[0] ?? {};

  test('the fixture starts checked, so a case that only added checks would fail', () => {
    expect(checkedProfiles(base).map((p) => p.network)).toEqual(['GitHub', 'LinkedIn']);
  });

  test('nothing checked: no external profile, no sameAs, no alternateName', () => {
    const fixture = withChecks(false, false);
    expect(checkedProfiles(fixture)).toEqual([]);
    expect(JSON.stringify(homeGraph(fixture))).not.toContain('sameAs');
    expect(site(fixture)).not.toHaveProperty('alternateName');
    expect(recordsOf(fixture).filter((r) => r.checked)).toEqual([]);
  });

  test('LinkedIn checked: it alone joins the links and sameAs, and the handle stays out', () => {
    const fixture = withChecks(true, false);
    expect(checkedProfiles(fixture).map((p) => p.network)).toEqual(['LinkedIn']);
    expect(JSON.stringify(homeGraph(fixture))).toContain(`"sameAs":["${linkedinUrl}"]`);
    expect(JSON.stringify(homeGraph(fixture))).not.toContain('github.com');
    expect(JSON.stringify(homeGraph(fixture))).not.toContain(HANDLE);
  });

  test('GitHub checked: it joins sameAs, and alternateName with it', () => {
    const fixture = withChecks(false, true);
    expect(checkedProfiles(fixture).map((p) => p.network)).toEqual(['GitHub']);
    expect(site(fixture)['alternateName']).toBe(HANDLE);
  });

  test('both checked: both join, in profile order', () => {
    expect(checkedProfiles(withChecks(true, true)).map((p) => p.network)).toEqual([
      'GitHub',
      'LinkedIn',
    ]);
  });

  test('isChecked reads the record, not its network', () => {
    expect(isChecked({ checked: today })).toBe(true);
    expect(isChecked({})).toBe(false);
  });

  // A profile off GitHub, unchecked, in every spelling a page could carry.
  const unchecked = recordsOf(withChecks(false, false)).filter((r) => r.url === linkedinUrl);
  const amp = '&';
  for (const text of [
    linkedinUrl,
    'https://www.linkedin.com/in/someone-example',
    'http://www.linkedin.com/in/someone-example/',
    'https://linkedin.com/in/someone-example',
    '//www.linkedin.com/in/someone-example/',
    'www.linkedin.com/in/someone-example/',
    'linkedin.com/in/someone-example',
    'HTTPS://WWW.LINKEDIN.COM/IN/SOMEONE-EXAMPLE/',
    'https://uk.linkedin.com/in/someone-example',
    'https:\\/\\/www.linkedin.com\\/in\\/someone-example\\/',
    `https://www.linkedin.com/in/someone${amp}#45;example/`,
    'https%3A%2F%2Fwww.linkedin.com%2Fin%2Fsomeone-example',
    '<p>someone-example</p>',
    'Find me as Someone-Example.',
  ]) {
    test(`caught while unchecked: ${text}`, () => {
      expect(recordLeaks(text, unchecked)).not.toEqual([]);
    });
  }
  for (const text of [
    'https://www.linkedin.com/in/someone-else/',
    'https://www.linkedin.com/in/someone-example-2/',
    'someone-examples',
    'https://ihaveasegway.com/',
  ]) {
    test(`passed: ${text}`, () => expect(recordLeaks(text, unchecked)).toEqual([]));
  }
  test('a checked record gives nothing away', () => {
    expect(recordLeaks(linkedinUrl, recordsOf(withChecks(true, false)))).toEqual([]);
  });
});

describe('known answers for the matcher', () => {
  const none = new Set<string>();
  const amp = '&';
  const caught = [
    `https://github.com/${HANDLE}`,
    `//raw.githubusercontent.com/${HANDLE}/a-repo/main/README.md`,
    `see gist.github.com/${HANDLE} for more`,
    `https://pkg.go.dev/github.com/${HANDLE}/a-repo`,
    'https://ihaveasegway.github.io/',
    `https://x.com/${HANDLE}`,
    `https:${amp}#x2F;${amp}#x2F;github.com/${HANDLE}`,
    `https://github${amp}#46;com/${HANDLE}`,
    `{"sameAs":["https:\\/\\/github.com\\/${HANDLE}"]}`,
  ];
  for (const text of caught) {
    test(`caught: ${text}`, () => {
      expect(urlsIn(text).flatMap((url) => verdict(url, 'index.html', none) ?? [])).not.toEqual([]);
    });
  }
  // In a script: written through innerHTML, escaped as a string, or split by markup.
  const bs = '\\';
  const caughtInScript = [
    `a${amp}${amp}b;x.href="https:${bs}u002f${bs}u002fgithub.com${bs}u002f${HANDLE}"`,
    `x.innerHTML="<a href=https://github${amp}#46;com/${HANDLE}>"`,
    `x.innerHTML="https://git<wbr>hub.com/${HANDLE}"`,
    `x.href="https://github${bs}x2ecom/${HANDLE}"`,
  ];
  for (const text of caughtInScript) {
    test(`caught in a script: ${text}`, () => {
      const found = urlsIn(text, 'script').flatMap((url) => verdict(url, 'app.js', none) ?? []);
      expect(found).not.toEqual([]);
    });
  }
  const passed = [
    'https://ihaveasegway.com/',
    'mailto:hello@ihaveasegway.com',
    'https://IHaveASegway.com/og.png',
    'https://openfontlicense.org',
  ];
  for (const text of passed) {
    test(`passed: ${text}`, () => {
      expect(urlsIn(text).flatMap((url) => verdict(url, 'index.html', none) ?? [])).toEqual([]);
    });
  }
  test('a checked record passes in any spelling of its URL', () => {
    const checked = new Set([canonical(`https://github.com/${HANDLE}`)]);
    expect(verdict(`http://www.github.com/${HANDLE.toLowerCase()}/`, 'index.html', checked)).toBe(
      null,
    );
  });
  test('a license notice passes only in its own file', () => {
    const url = 'https://github.com/polarsys/b612';
    expect(verdict(url, 'fonts/OFL-B612Mono.txt', none)).toBeNull();
    expect(verdict(url, 'index.html', none)).not.toBeNull();
  });
});
