import { describe, expect, test } from 'vitest';
import { MANIFEST } from '../src/lib/nav';
import { isNoindex } from '../src/lib/noindex.mjs';
import { checkedProfiles } from '../src/lib/profile';
import { CONTACT_EMAIL } from '../src/lib/site';
import { THEME_STATES } from '../src/lib/theme';
import { contains, isToggle, matches } from '../src/scripts/palette.js';
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

// Enter goes to the first row that holds the query whole, so "bak" opens the bakery, not the Raft
// cluster whose "Break a" holds b, a and k in order.
test('known answers: a whole match is the query as typed, its letters together', () => {
  expect(matches('bak', 'Break a Raft cluster')).toBe(true);
  expect(contains('bak', 'Break a Raft cluster')).toBe(false);
  expect(contains('bak', 'Plan a bakery’s deliveries')).toBe(true);
  expect(contains('RAFT', 'Break a Raft cluster')).toBe(true);
  expect(contains('resume', 'Résumé')).toBe(true);
  expect(contains('raft  cluster', 'Break a Raft cluster')).toBe(true);
  expect(contains('', 'Writing')).toBe(false);
  expect(contains('   ', 'Writing')).toBe(false);
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

    // Two buttons, one shown at a time (ADR 0022): the rail's search field, then the header row's.
    // A button's name is its words; its keys are shown beside them and hidden from assistive
    // technology, which aria-keyshortcuts tells instead (ADR 0025): the command key is a drawing,
    // since Barlow has no ⌘. Until then the name was "Search Ctrl K", the keys read as words.
    test("the header's buttons open it, name themselves in words, and show its keys", () => {
      const buttons = elementsOf(page).filter((e) => attribute(e, 'data-palette-open') === '');
      expect(buttons.map((b) => nameOf(b))).toEqual(['Search', 'Command menu']);
      for (const button of buttons) {
        expect(button.tagName).toBe('button');
        expect(attribute(button, 'aria-haspopup')).toBe('dialog');
        expect(attribute(button, 'aria-keyshortcuts')).toBe('Meta+K Control+K');
        const keys = descendants(button).filter((e) => e.tagName === 'kbd');
        expect(keys).toHaveLength(1);
        expect(attribute(keys[0] as Element, 'aria-hidden')).toBe('true');
        expect(textOf(keys[0] as Element)).toBe('Ctrl K');
        expect(descendants(keys[0] as Element).some((e) => e.tagName === 'svg')).toBe(true);
      }
    });

    // The rail lists every demo and only the newest posts; the menu finds every one of either.
    test('Lab and Writing list every demo and every published post, each a page this build writes', () => {
      const demos = [...built].filter((p) => /^\/lab\/[^/]+\/$/.test(p)).sort();
      const posts = [...built].filter((p) => /^\/(writing|notes)\/[^/]+\/$/.test(p)).sort();
      expect((groups.get('Lab') ?? []).map(([, href]) => href).sort()).toEqual(demos);
      expect((groups.get('Writing') ?? []).map(([, href]) => href).sort()).toEqual(posts);
    });
  });
}
