import type { DefaultTreeAdapterTypes } from 'parse5';
import { describe, expect, test } from 'vitest';
import { decodeReferences } from '../src/lib/held-names';
import { isNoindex } from '../src/lib/noindex.mjs';
import type { Post } from '../src/lib/posts';
import { checkedProfiles } from '../src/lib/profile';
import { ABOUT_PATH } from '../src/lib/about';
import { addressText, evidencePages, roleYears, shownSkills } from '../src/lib/resume';
import { CONTACT_EMAIL, ORIGIN } from '../src/lib/site';
import { featuredFirst, type WorkCard } from '../src/lib/work';
import { files, html, profile, read } from './support/dist';
import { attribute, descendants, elementsOf, hasClass, type Element } from './support/html';

// The résumé, on /about/ since 2026-10-28 (content.md, "Résumé"; lib/resume.ts), on every build
// vitest.config.ts names: the real
// one, whose profile holds no role or skill yet, and the fixture builds, whose profile fixture holds
// ten roles and twelve skills, the schema's limits. Each section must show exactly what its source
// holds, and nothing when it holds nothing: no placeholder, no empty heading. Expected values are
// worked out from profile.json and from the build's own pages, not from the page's own code.

type Text = DefaultTreeAdapterTypes.TextNode;

/** An element's text, as a reader gets it: its text nodes, references decoded, spaces collapsed. */
function textOf(element: Element | undefined): string {
  if (element === undefined) return '';
  const parts: string[] = [];
  const walk = (node: Element) => {
    for (const child of node.childNodes) {
      if (child.nodeName === '#text') parts.push((child as Text).value);
      else if ('tagName' in child) walk(child);
    }
  };
  walk(element);
  return decodeReferences(parts.join('')).replace(/\s+/g, ' ').trim();
}

const page = read('about/index.html');
const elements = elementsOf(page);
const byClass = (name: string, within: readonly Element[] = elements) =>
  within.filter((e) => hasClass(e, name));
/** The section a heading of this text opens, or undefined when the page has none. */
const section = (title: string) =>
  elements.find(
    (e) =>
      e.tagName === 'section' &&
      descendants(e).some((d) => hasClass(d, 'section-title') && textOf(d) === title),
  );
const links = (within: Element | undefined) =>
  within === undefined
    ? []
    : descendants(within)
        .filter((e) => e.tagName === 'a')
        .map((a) => ({ href: attribute(a, 'href') ?? '', text: textOf(a) }));

/** A page this build lists: written, and not a draft. */
const lists = (path: string) => {
  const file = `${path.slice(1)}index.html`;
  return files.includes(file) && !isNoindex(read(file));
};
/** A listed page's own title: its <h1>. */
const headingOf = (path: string) =>
  textOf(elementsOf(read(`${path.slice(1)}index.html`)).find((e) => e.tagName === 'h1'));

describe('/about/, the résumé', () => {
  test('every build writes it, under its canonical URL, with the name as its one heading', () => {
    expect(html).toContain('about/index.html');
    expect(html).not.toContain('resume/index.html');
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}${ABOUT_PATH}">`);
    expect(elements.filter((e) => e.tagName === 'h1').map(textOf)).toEqual([profile.basics.name]);
    expect(textOf(byClass('hero-title')[0])).toBe(profile.basics.label);
  });

  test('its contact list is the address, the site, and the checked profiles, each as its address', () => {
    const list = byClass('resume-contact')[0];
    const terms = descendants(list as Element)
      .filter((e) => e.tagName === 'dt')
      .map(textOf);
    const checked = checkedProfiles(profile);
    expect(terms).toEqual(['Email', 'Web', ...checked.map((p) => p.network)]);
    expect(links(list)).toEqual([
      { href: `mailto:${CONTACT_EMAIL}`, text: CONTACT_EMAIL },
      { href: '/', text: 'ihaveasegway.com' },
      ...checked.map((p) => ({ href: p.url, text: addressText(p.url) })),
    ]);
  });

  test('Experience lists exactly the roles profile.json holds, then the ways to the full history', () => {
    const experience = section('Experience');
    expect(experience).toBeDefined();
    const rows = descendants(experience as Element).filter(
      (e) => e.tagName === 'li' && descendants(e).some((d) => hasClass(d, 'role-title')),
    );
    expect(
      rows.map((row) => [
        textOf(byClass('role-years', descendants(row))[0]),
        textOf(byClass('role-title', descendants(row))[0]),
      ]),
    ).toEqual(profile.work.map((role) => [roleYears(role), role.position]));
    // No list at all without a role: never an empty one.
    expect(byClass('roles', descendants(experience as Element))).toHaveLength(
      profile.work.length > 0 ? 1 : 0,
    );
    const notes = byClass('resume-notes', descendants(experience as Element))[0];
    const linkedIn = checkedProfiles(profile).find((p) => p.network === 'LinkedIn');
    expect(
      descendants(notes as Element)
        .filter((e) => e.tagName === 'p')
        .map(textOf),
    ).toEqual([
      ...(linkedIn ? ['Full history on LinkedIn.'] : []),
      `Full résumé on request: ${CONTACT_EMAIL}.`,
    ]);
    expect(links(notes)).toEqual([
      ...(linkedIn ? [{ href: linkedIn.url, text: 'LinkedIn' }] : []),
      { href: `mailto:${CONTACT_EMAIL}`, text: CONTACT_EMAIL },
    ]);
  });

  test('a skill shows exactly when every page it names is listed in this build, each linked by its own title', () => {
    const expected = profile.skills
      .filter((skill) => skill.evidence.every(lists))
      .map((skill) => ({
        name: skill.name,
        evidence: skill.evidence.map((href) => ({ href, text: headingOf(href) })),
      }));
    const skills = section('Skills');
    expect(skills !== undefined, 'the section renders exactly when a skill does').toBe(
      expected.length > 0,
    );
    const rows = skills
      ? descendants(skills).filter((e) => e.tagName === 'div' && e.parentNode?.nodeName === 'dl')
      : [];
    expect(
      rows.map((row) => ({
        name: textOf(descendants(row).find((e) => e.tagName === 'dt')),
        evidence: links(descendants(row).find((e) => e.tagName === 'dd')),
      })),
    ).toEqual(expected);
  });

  /** A section's cards, by title and link, in page order. */
  const cardsOf = (within: Element | undefined) =>
    within === undefined
      ? []
      : byClass('card', descendants(within)).map((card) => ({
          title: textOf(byClass('card-title', descendants(card))[0]),
          href: attribute(byClass('card-more', descendants(card))[0] as Element, 'href'),
        }));
  const home = elementsOf(read('index.html'));
  const homeSection = (id: string) =>
    home.find((e) => e.tagName === 'section' && attribute(e, 'id') === id);
  /** A section's post links, in page order. */
  const postTitles = (within: Element | undefined) =>
    within === undefined
      ? []
      : byClass('post-title', descendants(within)).map((t) => links(t)[0]?.href);

  // Home leads with the demos it features (ADR 0024); the order is Home's, the cards are the list's.
  test("Selected work is Home's, card for card: one list feeds both (lib/content.ts)", () => {
    const listed = cardsOf(section('Selected work')).map((card) => ({
      ...card,
      link: { href: card.href ?? '' },
    }));
    expect(featuredFirst(listed).map(({ title, href }) => ({ title, href }))).toEqual(
      cardsOf(homeSection('work')),
    );
  });

  test("Writing lists Home's latest posts, and renders exactly when Home lists one", () => {
    const latest = postTitles(homeSection('writing'));
    expect(postTitles(section('Writing'))).toEqual(latest);
    expect(section('Writing') !== undefined).toBe(latest.length > 0);
  });

  test("the printed links' domain is site.ts's ORIGIN: the stylesheet names it once", () => {
    const sheet = elements.find(
      (e) => e.tagName === 'link' && attribute(e, 'rel') === 'stylesheet',
    );
    const css = read((attribute(sheet as Element, 'href') ?? '').slice(1));
    const domains = [...css.matchAll(/content:"([^"]*)" attr\(href\)/g)].map(([, d]) => d);
    expect(domains).toEqual([new URL(ORIGIN).host]);
  });

  test('its link preview draws the name and the label the header gives it', () => {
    expect(page).toContain(`<meta property="og:title" content="${profile.basics.name} · About">`);
    expect(page).toContain('<title>About · Joseph Peterson</title>');
    expect(files).toContain('about/og.png');
    expect(files).not.toContain('resume/og.png');
  });
});

// Known answers on lib/resume.ts, with inputs of their own.
const post = (slug: string, title: string): Post => ({
  section: 'writing',
  slug,
  title,
  summary: 's',
  published: new Date('2026-10-20T00:00:00Z'),
  updated: null,
  draft: false,
  tags: [],
  kind: 'essay',
  source: null,
});
const card = (href: string, title: string): WorkCard => ({
  title,
  text: 't',
  facts: [],
  link: { href, label: 'Try it', external: !href.startsWith('/') },
});

test("known answers: a role's years", () => {
  expect(roleYears({ startDate: '2019', endDate: '2024' })).toBe('2019–2024');
  expect(roleYears({ startDate: '2021' })).toBe('Since 2021');
  expect(roleYears({ startDate: '2013', endDate: '2013' })).toBe('2013');
});

test('known answers: evidence pages are pages on this site, titled by their own titles', () => {
  const targets = evidencePages(
    [card('/lab/routes/', 'Plan the routes'), card('https://github.com/x/y', 'y')],
    [post('a-post', 'A post')],
    [
      { href: '/writing/', label: 'Writing' },
      { href: '/rss.xml', label: 'RSS' },
      { href: '/about/', label: 'About' },
      { href: '/', label: 'Home' },
    ],
  );
  expect([...targets]).toEqual([
    ['/lab/routes/', 'Plan the routes'],
    ['/writing/a-post/', 'A post'],
    ['/writing/', 'Writing'],
  ]);
});

test('known answers: a skill shows only with every page it names, in profile order', () => {
  const targets = new Map([
    ['/lab/routes/', 'Plan the routes'],
    ['/writing/a-post/', 'A post'],
  ]);
  const skills = shownSkills(
    [
      { name: 'Both', evidence: ['/lab/routes/', '/writing/a-post/'] },
      { name: 'Half', evidence: ['/lab/routes/', '/writing/not-built/'] },
      { name: 'None', evidence: ['/lab/nowhere/'] },
      { name: 'One', evidence: ['/writing/a-post/'] },
    ],
    targets,
  );
  expect(skills).toEqual([
    {
      name: 'Both',
      evidence: [
        { href: '/lab/routes/', title: 'Plan the routes' },
        { href: '/writing/a-post/', title: 'A post' },
      ],
    },
    { name: 'One', evidence: [{ href: '/writing/a-post/', title: 'A post' }] },
  ]);
});

test('known answers: an address as text', () => {
  expect(addressText('https://www.linkedin.com/in/someone/')).toBe('linkedin.com/in/someone');
  expect(addressText('https://ihaveasegway.com')).toBe('ihaveasegway.com');
  expect(addressText('https://github.com/IHaveASegway')).toBe('github.com/IHaveASegway');
});
