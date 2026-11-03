import { describe, expect, test } from 'vitest';
import { MANIFEST } from '../src/lib/nav';
import { isNoindex } from '../src/lib/noindex.mjs';
import { checkedProfiles } from '../src/lib/profile';
import { CONTACT_EMAIL } from '../src/lib/site';
import { THEME_STATES } from '../src/lib/theme';
import { isToggle, matches, narrowed, rankOf } from '../src/scripts/palette.js';
import { files, html, profile, read } from './support/dist';
import { importsOf } from './support/measure';
import { attribute, descendants, elementsOf, hasClass, type Element } from './support/html';

// The command menu (design-system.md, "The command menu"): the key that opens it, the filter, and
// the rows every page carries. e2e/palette.spec.ts drives it in a browser.

const key = (event: Partial<KeyboardEvent>) =>
  isToggle({
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...event,
  });

test('known answers: ⌘K or Ctrl+K opens it, and nothing on a bare key (SC 2.1.4)', () => {
  expect(key({ key: 'k', code: 'KeyK', metaKey: true })).toBe(true);
  expect(key({ key: 'k', code: 'KeyK', ctrlKey: true })).toBe(true);
  expect(key({ key: 'K', code: 'KeyK', ctrlKey: true })).toBe(true);
  // A bare key, another modifier, or a held key opens nothing.
  expect(key({ key: 'k', code: 'KeyK' })).toBe(false);
  expect(key({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true })).toBe(false);
  expect(key({ key: 'k', code: 'KeyK', metaKey: true, altKey: true })).toBe(false);
  expect(key({ key: 'k', code: 'KeyK', ctrlKey: true, repeat: true })).toBe(false);
  expect(key({ key: 'j', code: 'KeyJ', ctrlKey: true })).toBe(false);
  // A layout whose K key types a letter outside a to z: the key's place counts (Russian's "л").
  expect(key({ key: 'л', code: 'KeyK', ctrlKey: true })).toBe(true);
  // A layout that moves the letters (Dvorak's "t" sits where QWERTY's K does): the letter counts.
  expect(key({ key: 't', code: 'KeyK', ctrlKey: true })).toBe(false);
  expect(key({ key: 'k', code: 'KeyV', ctrlKey: true })).toBe(true);
  // Inside a composition the input method has the key: Japanese turns the text to katakana.
  expect(key({ key: 'Process', code: 'KeyK', ctrlKey: true, isComposing: true })).toBe(false);
  expect(key({ key: 'k', code: 'KeyK', ctrlKey: true, keyCode: 229 })).toBe(false);
});

test('its bundle is one file that imports nothing, so a page loads it and nothing more', () => {
  const bundles = files.filter((f) =>
    /^_astro\/Palette\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/.test(f),
  );
  expect(bundles).toHaveLength(1);
  expect(importsOf(read(bundles[0] ?? ''))).toEqual([]);
  expect(read(bundles[0] ?? '')).not.toMatch(/\bimport\s*[({'"`]/);
});

test('known answers: the filter matches by subsequence, without case or accents', () => {
  expect(matches('', 'Writing')).toBe(true);
  expect(matches('wrt', 'Writing')).toBe(true);
  expect(matches('WRT', 'Writing')).toBe(true);
  expect(matches('resume', 'Résumé')).toBe(true);
  expect(matches('résumé', 'Resume')).toBe(true);
  expect(matches('cv', 'Résumé cv experience')).toBe(true);
  expect(matches('copy email', 'Copy email address')).toBe(true);
  // Order matters, and every character must be there.
  expect(matches('tw', 'Writing')).toBe(false);
  expect(matches('writings', 'Writing')).toBe(false);
  expect(matches('lab', 'LinkedIn')).toBe(false);
});

// Enter goes to the row that holds the query whole, so "bak" opens the bakery, not the Raft cluster
// whose "Break a" holds b, a and k in order.
test('known answers: a whole match is the query as typed, its letters together', () => {
  expect(matches('bak', 'Break a Raft cluster')).toBe(true);
  expect(rankOf('bak', { names: ['Break', 'a', 'Raft', 'cluster'] })).toBe(1);
  expect(rankOf('bak', { names: ['Plan a bakery’s deliveries'] })).toBe(3);
  expect(rankOf('RAFT', { names: ['Break a Raft cluster'] })).toBe(3);
  expect(rankOf('resume', { names: ['Résumé'] })).toBe(5);
  expect(rankOf('raft  cluster', { names: ['Break a Raft cluster'] })).toBe(3);
  expect(rankOf('   ', { names: ['Writing'] })).toBe(1);
});

// How a row answers: known answers for each rank, and what the rank is for.
test('known answers: a label that starts with the query beats a keyword, then a name that holds it, a summary and scattered letters', () => {
  const row = { names: ['Writing', 'essays', 'Copy email address'], summary: 'A week of reports' };
  expect(rankOf('wri', row)).toBe(5);
  expect(rankOf('essay', row)).toBe(4);
  expect(rankOf('ESSAYS', row)).toBe(4);
  expect(rankOf('copy email', row)).toBe(4);
  expect(rankOf('email', row)).toBe(3);
  expect(rankOf('reports', row)).toBe(2);
  expect(rankOf('wrt', row)).toBe(1);
  expect(rankOf('zzz', row)).toBe(0);
  expect(rankOf('', row)).toBe(1);
  // A keyboard's apostrophe finds a typeset one, and an accent counts for nothing.
  expect(rankOf("bakery's", { names: ['Plan a bakery’s deliveries'] })).toBe(3);
  expect(rankOf('resume', { names: ['Résumé'] })).toBe(5);
  // A title and a summary count only whole: their scattered letters find nothing.
  expect(rankOf('wky', { names: ['Lab'], summary: 'A week of reports' })).toBe(0);
  const post = { names: ['Four', 'locks,', 'none', 'of', 'them', 'closed'] };
  expect(rankOf('rsm', { ...post, title: 'Four locks, none of them closed' })).toBe(0);
  expect(rankOf('none of them', { ...post, title: 'Four locks, none of them closed' })).toBe(3);
});

test('known answers: scattered letters leave the list once a row holds the query whole', () => {
  const copy = { id: 'copy', names: ['Copy email address'] };
  const writing = { id: 'writing', names: ['Writing', 'rss'] };
  const raft = {
    id: 'raft',
    names: ['Break', 'a', 'Raft', 'cluster'],
    title: 'Break a Raft cluster',
  };
  const bakery = { id: 'bakery', names: ['Plan', 'bakery’s', 'deliveries'] };
  const ids = (found: { shown: { id: string }[]; active?: { id: string } }) => ({
    shown: found.shown.map((row) => row.id),
    active: found.active?.id,
  });
  // "address" holds an r and two s's, and "Break" a b, an a and a k.
  expect(ids(narrowed('rss', [copy, writing]))).toEqual({ shown: ['writing'], active: 'writing' });
  expect(ids(narrowed('bak', [raft, bakery]))).toEqual({ shown: ['bakery'], active: 'bakery' });
  // With nothing whole, the scattered letters are what's left.
  expect(ids(narrowed('rss', [copy]))).toEqual({ shown: ['copy'], active: 'copy' });
  expect(ids(narrowed('cpy', [writing, copy]))).toEqual({ shown: ['copy'], active: 'copy' });
  expect(ids(narrowed('zzz', [writing, copy]))).toEqual({ shown: [], active: undefined });
  // An empty query keeps every row and selects the first.
  expect(ids(narrowed('', [writing, copy]))).toEqual({
    shown: ['writing', 'copy'],
    active: 'writing',
  });
});

/** A page's menu: its dialog, and its rows by group, as [label, href or action]. */
function menuOf(page: string): { dialog: Element | undefined; groups: Map<string, string[][]> } {
  const elements = elementsOf(page);
  const dialog = elements.find(
    (e) => e.tagName === 'dialog' && attribute(e, 'data-palette') === '',
  );
  const groups = new Map<string, string[][]>();
  if (dialog === undefined) return { dialog, groups };
  const inside = descendants(dialog);
  for (const group of inside.filter((e) => attribute(e, 'role') === 'group')) {
    const label = inside.find((e) => attribute(e, 'id') === attribute(group, 'aria-labelledby'));
    const rows = descendants(group)
      .filter((e) => attribute(e, 'role') === 'option')
      .map((row) => [
        textOf(row, true),
        attribute(row, 'data-href') ?? `act:${attribute(row, 'data-act') ?? ''}`,
      ]);
    groups.set(label ? textOf(label) : '?', rows);
  }
  return { dialog, groups };
}

/** An element's name as assistive technology reads it from its text: what is not aria-hidden. */
function nameOf(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Element) => {
    for (const child of node.childNodes) {
      if ('value' in child && typeof child.value === 'string') parts.push(child.value);
      else if ('tagName' in child && attribute(child, 'aria-hidden') !== 'true') walk(child);
    }
  };
  walk(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** An element's text; with `first`, a row's label only, before any value or state beside it. */
function textOf(element: Element, first = false): string {
  const parts: string[] = [];
  const walk = (node: Element) => {
    for (const child of node.childNodes) {
      if ('value' in child && typeof child.value === 'string') parts.push(child.value);
      else if ('tagName' in child) {
        if (first && parts.join('').trim() !== '') return;
        walk(child);
        if (first) return;
      }
    }
  };
  walk(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** A row as the menu's script reads it from the page. */
function rowOf(option: Element) {
  const keys = (attribute(option, 'data-keys') ?? '').split(' ');
  const find = attribute(option, 'data-find');
  const base = { id: attribute(option, 'id') ?? '' };
  const title = `${textOf(option)} ${keys.join(' ')}`;
  if (find !== undefined) {
    return { ...base, title, summary: find, names: [...textOf(option).split(/\s+/), ...keys] };
  }
  const parts = option.childNodes.map((child) => {
    if ('value' in child && typeof child.value === 'string') return child.value;
    return 'tagName' in child ? textOf(child) : '';
  });
  return { ...base, title, names: [...parts, ...keys] };
}

// The words a visitor brings, against the rows the build wrote: the site's own words first, and
// words that once fell to scattered letters. Until 2026-11-02 "essay", "labs" and "blog" said no
// matches on a site whose nav says Writing and Lab, and "rss" and "adr" selected Copy email address
// through the letters of "address", so Enter copied it.
describe('what a visitor types finds the page they mean', () => {
  const rows = (file: string) => {
    const dialog = menuOf(read(file)).dialog as Element;
    return descendants(dialog)
      .filter((e) => attribute(e, 'role') === 'option')
      .map(rowOf);
  };
  const lab = html.includes('lab/index.html');
  const writing = html.includes('writing/index.html');
  const about = html.includes('about/index.html');
  const pick = (query: string, file = 'index.html') => narrowed(query, rows(file)).active?.id;

  test.runIf(writing)('essay, essays, blog, rss and feed: Writing', () => {
    for (const query of ['essay', 'essays', 'blog', 'rss', 'feed', 'post', 'article'])
      expect(pick(query), query).toBe('palette-writing');
  });

  test.runIf(lab)('labs, lab and demo: Lab', () => {
    for (const query of ['lab', 'labs', 'demo', 'projects'])
      expect(pick(query), query).toBe('palette-lab');
  });

  // "adrs" holds a, d, r and s in order in "address", as "adr" does, and "decision records" is the
  // site's own term in two words, which a keyword split on its spaces can't hold.
  test("adr, adrs and the site's two terms for them: Home, which counts them, never the address", () => {
    for (const query of ['adr', 'adrs', 'decisions', 'decision records', 'written decisions'])
      expect(pick(query), query).toBe('palette-home');
  });

  // What a row says beats what it's also called: a keyword doesn't take a letter from a label.
  test('the first letter of a label finds that label, over a keyword that starts with it', () => {
    if (writing) expect(pick('w')).toBe('palette-writing');
    if (about) expect(pick('a')).toBe('palette-about');
    expect(pick('h')).toBe('palette-home');
  });

  test('copying the address is still found by its own words', () => {
    for (const query of ['copy', 'email', 'mail', 'contact', 'cpy'])
      expect(pick(query), query).toBe('palette-copy');
  });

  test.runIf(about)('print and pdf: About from another page, its Print row on /about/', () => {
    for (const query of ['print', 'pdf']) {
      expect(pick(query), query).toBe('palette-about');
      expect(pick(query, 'about/index.html'), query).toBe('palette-print');
    }
    for (const query of ['resume', 'cv']) expect(pick(query), query).toBe('palette-about');
  });
});

// The pages a visitor can reach: a draft (noindex, in a preview only) is built but linked from
// nowhere, the menu included (lib/posts.ts).
const built = new Set(
  files
    .filter((f) => f.endsWith('index.html') && !isNoindex(read(f)))
    .map((f) => `/${f.replace(/index\.html$/, '')}`),
);

for (const file of html) {
  describe(file, () => {
    const page = read(file);
    const { dialog, groups } = menuOf(page);

    test('one menu, a modal dialog the page does not draw until it opens', () => {
      expect(dialog).toBeDefined();
      expect(page.match(/<dialog\b/g)).toHaveLength(1);
      expect(attribute(dialog as Element, 'open')).toBeUndefined();
      expect(attribute(dialog as Element, 'aria-label')).toBe('Command menu');
    });

    test('Go to lists Home and the pages the nav lists, in its order', () => {
      const pages = MANIFEST.filter((i) => i.href.endsWith('/') && built.has(i.href));
      expect(groups.get('Go to')).toEqual([['Home', '/'], ...pages.map((i) => [i.label, i.href])]);
    });

    // Print only where the page has the button the row presses: /about/, whose Print button is
    // also the only one, so the row never presses a button that is not there.
    test('Actions copy the address and press the theme toggle, under its own names', () => {
      const printButton = /<button\b[^>]*\bdata-print\b/.test(page);
      expect(printButton).toBe(file === 'about/index.html');
      expect(groups.get('Actions')).toEqual([
        ['Copy email address', 'act:copy'],
        [THEME_STATES[0].name, 'act:theme'],
        ...(printButton ? [['Print or save as PDF', 'act:print']] : []),
      ]);
      const rows = descendants(dialog as Element);
      const copy = rows.find((e) => attribute(e, 'data-act') === 'copy');
      expect(copy && attribute(copy, 'data-copy')).toBe(CONTACT_EMAIL);
      const theme = rows.find((e) => attribute(e, 'data-act') === 'theme');
      const states = descendants(theme as Element).filter((e) => hasClass(e, 'palette-theme'));
      expect(states.map((e) => [attribute(e, 'data-for'), textOf(e)])).toEqual(
        THEME_STATES.map(({ theme: t, name }) => [t, name]),
      );
    });

    test('Links are the profiles whose check is recorded, and nothing else', () => {
      const checked = checkedProfiles(profile).map((p) => [p.network, p.url]);
      expect(groups.get('Links') ?? []).toEqual(checked);
      for (const p of profile.basics.profiles.filter((p) => !checked.some(([, u]) => u === p.url)))
        expect(page).not.toContain(`data-href="${p.url}"`);
    });

    test('the combobox names a listbox that exists, and each row has an id of its own', () => {
      const inside = descendants(dialog as Element);
      const input = inside.find((e) => e.tagName === 'input');
      expect(input && attribute(input, 'role')).toBe('combobox');
      expect(input && attribute(input, 'type')).toBe('text');
      expect(input && attribute(input, 'aria-expanded')).toBe('true');
      expect(input && attribute(input, 'aria-activedescendant')).toBeUndefined();
      const list = inside.find(
        (e) => attribute(e, 'id') === attribute(input as Element, 'aria-controls'),
      );
      expect(list && attribute(list, 'role')).toBe('listbox');
      const ids = inside
        .filter((e) => attribute(e, 'role') === 'option')
        .map((e) => attribute(e, 'id'));
      expect(ids.every((id) => id !== undefined && /^palette(-[a-z0-9]+)+$/.test(id))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(inside.filter((e) => attribute(e, 'aria-selected') !== undefined)).toEqual([]);
      // Its status region is inside the dialog: the page behind a modal dialog is inert.
      expect(inside.filter((e) => attribute(e, 'role') === 'status')).toHaveLength(1);
    });

    // One button, the top bar's Search (ADR 0027), at every width; until then the rail's search
    // field and the bar's "Command menu" were two, one shown at a time (ADR 0022). Its name is its
    // word and the keys it shows, since a name holds the visible label (SC 2.5.3). The command key
    // is a drawing (no face draws ⌘), hidden from assistive technology; aria-keyshortcuts tells
    // the keys too.
    test("the header's button opens it, and names itself with the keys it shows", () => {
      const buttons = elementsOf(page).filter((e) => attribute(e, 'data-palette-open') === '');
      expect(buttons.map((b) => nameOf(b))).toEqual(['Search Ctrl K']);
      for (const button of buttons) {
        expect(button.tagName).toBe('button');
        expect(attribute(button, 'aria-haspopup')).toBe('dialog');
        expect(attribute(button, 'aria-keyshortcuts')).toBe('Meta+K Control+K');
        const keys = descendants(button).filter((e) => e.tagName === 'kbd');
        expect(keys).toHaveLength(1);
        expect(attribute(keys[0] as Element, 'aria-hidden')).toBeUndefined();
        expect(textOf(keys[0] as Element)).toBe('Ctrl K');
        const drawn = descendants(keys[0] as Element).filter((e) => e.tagName === 'svg');
        expect(drawn).toHaveLength(1);
        expect(attribute(drawn[0] as Element, 'aria-hidden')).toBe('true');
        // What a sighted visitor reads on the button is in its name.
        expect(nameOf(button)).toContain(textOf(keys[0] as Element));
      }
    });

    // The menu finds every demo and every post.
    test('Lab and Writing list every demo and every published post, each a page this build writes', () => {
      const demos = [...built].filter((p) => /^\/lab\/[^/]+\/$/.test(p)).sort();
      const posts = [...built].filter((p) => /^\/(writing|notes)\/[^/]+\/$/.test(p)).sort();
      expect((groups.get('Lab') ?? []).map(([, href]) => href).sort()).toEqual(demos);
      expect((groups.get('Writing') ?? []).map(([, href]) => href).sort()).toEqual(posts);
    });
  });
}
