import type { DefaultTreeAdapterTypes } from 'parse5';
import { describe, expect, test } from 'vitest';
import { decodeReferences } from '../src/lib/held-names';
import { checkedProfiles } from '../src/lib/profile';
import { ABOUT_PATH } from '../src/lib/about';
import { addressText, roleYears } from '../src/lib/resume';
import { CONTACT_EMAIL, ORIGIN } from '../src/lib/site';
import { files, html, profile, read } from './support/dist';
import { attribute, descendants, elementsOf, hasClass, type Element } from './support/html';

// The résumé, on /about/ since 2026-10-28 (content.md, "Résumé"; lib/resume.ts), on every build
// vitest.config.ts names: the real one, whose profile holds no role yet, and the fixture builds,
// whose profile fixture holds ten roles, the schema's limit. Each section must show exactly what its source
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
      descendants(e).some(
        (d) => (hasClass(d, 'section-title') || hasClass(d, 'block-label')) && textOf(d) === title,
      ),
  );
const links = (within: Element | undefined) =>
  within === undefined
    ? []
    : descendants(within)
        .filter((e) => e.tagName === 'a')
        .map((a) => ({ href: attribute(a, 'href') ?? '', text: textOf(a) }));

describe('/about/, the résumé', () => {
  test('every build writes it, under its canonical URL, with the name as its one heading', () => {
    expect(html).toContain('about/index.html');
    expect(html).not.toContain('resume/index.html');
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}${ABOUT_PATH}">`);
    expect(elements.filter((e) => e.tagName === 'h1').map(textOf)).toEqual([profile.basics.name]);
    expect(textOf(byClass('about-role')[0])).toBe(profile.basics.label);
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

  test('Background lists exactly the roles profile.json holds, then the ways to the full history', () => {
    const experience = section('Background');
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
      ...(profile.basics.summary ? [profile.basics.summary] : []),
      ...(linkedIn ? ['My full work history is on LinkedIn.'] : []),
    ]);
    expect(links(notes)).toEqual(linkedIn ? [{ href: linkedIn.url, text: 'LinkedIn' }] : []);
  });

  // Background and Selected work are paper's since 2026-11-03: the screen tells the same in the bio's
  // words. The skills' names print nowhere: they listed what the labs show as if Joseph had typed it,
  // so the tools line is the page's one list of what they've worked with.
  test('Background is on paper only, and no skill names print or show', () => {
    const experience = section('Background') as Element;
    expect(hasClass(experience, 'print-only')).toBe(true);
    expect(section('Skills')).toBeUndefined();
    expect(byClass('skills')).toEqual([]);
    // A name that lists what it holds: a lone word, TypeScript say, is the tools line's too.
    for (const skill of profile.skills.filter(({ name }) => name.includes(':')))
      expect(page, skill.name).not.toContain(skill.name);
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

  // One list feeds both (lib/content.ts). The résumé shows every item as a card; Home carries the
  // labs in its rows and links each (ADR 0028), and shows the rest as cards in Selected work.
  test("Selected work is Home's: its labs are the ones Home links, its other cards Home's, item for item", () => {
    const isLab = (href: string | null | undefined) => /^\/lab\/[a-z0-9-]+\/$/.test(href ?? '');
    const cards = cardsOf(section('Selected work'));
    const linked = new Set(home.filter((e) => e.tagName === 'a').map((e) => attribute(e, 'href')));
    for (const card of cards.filter((c) => isLab(c.href)))
      expect(linked.has(card.href), String(card.href)).toBe(true);
    expect(cards.filter((c) => !isLab(c.href))).toEqual(cardsOf(homeSection('work')));
  });

  test("Writing lists Home's latest posts, and renders exactly when Home lists one", () => {
    const latest = postTitles(homeSection('writing'));
    expect(postTitles(section('Writing'))).toEqual(latest);
    expect(section('Writing') !== undefined).toBe(latest.length > 0);
  });

  // The page links a stylesheet a component or the page owns as well as the site's (post-list.css,
  // about.css), so every sheet it links is read, and the domain is named once among them all.
  test("the printed links' domain is site.ts's ORIGIN: the stylesheets name it once", () => {
    const sheets = elements.filter(
      (e) => e.tagName === 'link' && attribute(e, 'rel') === 'stylesheet',
    );
    expect(sheets.length).toBeGreaterThan(0);
    const css = sheets.map((sheet) => read((attribute(sheet, 'href') ?? '').slice(1))).join('\n');
    const domains = [...css.matchAll(/content:"([^"]*)" attr\(href\)/g)].map(([, d]) => d);
    expect(domains).toEqual([new URL(ORIGIN).host]);
  });

  test('its link preview draws the name and the label the header gives it', () => {
    expect(page).toContain(`<meta property="og:title" content="${profile.basics.name} · About">`);
    // The tab says what the link preview does: on the page about him, his name comes first.
    expect(page).toContain('<title>Joseph Peterson · About</title>');
    expect(files).toContain('about/og.png');
    expect(files).not.toContain('resume/og.png');
  });
});

// Known answers on lib/resume.ts, with inputs of their own.
test("known answers: a role's years", () => {
  expect(roleYears({ startDate: '2019', endDate: '2024' })).toBe('2019–2024');
  expect(roleYears({ startDate: '2021' })).toBe('Since 2021');
  expect(roleYears({ startDate: '2013', endDate: '2013' })).toBe('2013');
});

test('known answers: an address as text', () => {
  expect(addressText('https://www.linkedin.com/in/someone/')).toBe('linkedin.com/in/someone');
  expect(addressText('https://ihaveasegway.com')).toBe('ihaveasegway.com');
  expect(addressText('https://github.com/IHaveASegway')).toBe('github.com/IHaveASegway');
});
