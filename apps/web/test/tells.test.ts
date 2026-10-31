import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { describe, expect, test } from 'vitest';
import { app, files, html, read } from './support/dist';

// The generic tells wave 1 of the identity removed (ADR 0025; design-system.md, "Type scale" and
// "Budgets as CI fitness functions"), held by the build so they cannot drift back one component at
// a time:
//
//   1. Capitals and tracking. No rule sets text-transform: uppercase, no letter-spacing is above
//      zero (the tracked, all-capital eyebrow), and a rule that sets the label face or a label's
//      size sets no letter-spacing but 0: labels are signage, in sentence case and untracked.
//   2. A dot or an arrow between words. Outside .prose, the text a page shows is links, buttons,
//      labels and page heads, and none of it holds a middle dot or an arrow: the site writes
//      "Remote, US", "View all demos", "Up and down to move". A stylesheet's generated content is
//      held to the same rule. .prose is Markdown from src/content, Joseph's writing, which this
//      check leaves to him: a post's body, the About page's bio and a lab's write-up; the Route
//      Lab's notes on how it is built stand in the write-up's .prose too, but they are this
//      repository's words, so the sources check below reads them where they are written. That
//      check also reads what a script writes once the page has loaded (a tip, a readout, a
//      status, the command menu's notes), which no built page holds.
//   3. Mono for code. A rule that sets a monospaced face targets code, kbd, samp or pre, and no
//      drawing sets one by attribute: the mono label of a value is gone.
//
// Each reads two places. The sources in src/styles name the rule to fix by file and line; the
// build's own stylesheets, linked and inline, are the backstop, since a utility class in markup
// (uppercase, tracking-widest, font-mono) or the word in a comment under src/ becomes a rule there
// without touching src/styles. Each family has known answers copied from main before this wave
// (ffb6fe5), which every check here fails, and the system's own rules, which it passes.
//
// The document's <head> is out of scope: "Lab · Joseph Peterson" in <title> and the link
// preview's title are the browser's and other sites' labels for the page, not text on it.

// ---------------------------------------------------------------------------------------------
// Reading a stylesheet

/** One declaration of a stylesheet, with the line it starts on and every prelude around it. */
export interface Declaration {
  readonly line: number;
  /** The block it sits in, numbered in order, so the declarations of one rule read together. */
  readonly block: number;
  /** The preludes around it, outermost first: at-rules and the rule's selector list. */
  readonly within: readonly string[];
  readonly property: string;
  readonly value: string;
}

const newlines = (text: string) => text.split('\n').length - 1;

/**
 * Every declaration in a stylesheet. Comments are skipped; quoted strings and brackets are read
 * whole, so a ";" or a "{" inside content: '…', url(…) or :not(…) does not end anything.
 */
export function declarationsOf(css: string): Declaration[] {
  const found: Declaration[] = [];
  const open: { prelude: string; block: number }[] = [];
  let blocks = 0;
  let text = '';
  let line = 1;
  let start = 1;
  let depth = 0;
  const close = () => {
    const chunk = text.trim();
    const colon = chunk.indexOf(':');
    const rule = open.at(-1);
    if (rule && colon > 0 && !chunk.startsWith('@')) {
      found.push({
        line: start,
        block: rule.block,
        within: open.map((o) => o.prelude),
        property: chunk.slice(0, colon).trim().toLowerCase(),
        value: chunk.slice(colon + 1).trim(),
      });
    }
    text = '';
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i] ?? '';
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      line += newlines(css.slice(i, stop));
      i = stop - 1;
      continue;
    }
    if (text.trim() === '' && !/\s/.test(c)) start = line;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      const quoted = css.slice(i, j + 1);
      line += newlines(quoted);
      text += quoted;
      i = j;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === '{') {
      open.push({ prelude: text.trim(), block: blocks++ });
      text = '';
      continue;
    } else if (depth === 0 && c === ';') {
      close();
      continue;
    } else if (depth === 0 && c === '}') {
      close();
      open.pop();
      continue;
    }
    if (c === '\n') line++;
    text += c;
  }
  return found;
}

/** The selector list a declaration styles: its innermost prelude that is not an at-rule, on one
 *  line. */
const selectorOf = (d: Declaration) =>
  (d.within.findLast((p) => !p.startsWith('@')) ?? '').replace(/\s+/g, ' ');

/** Whether a declaration sits in an @font-face rule, which names a face rather than sets one. */
const inFontFace = (d: Declaration) => d.within.some((p) => /^@font-face\b/i.test(p));

/** The custom properties a set of stylesheets defines, by name; a later definition wins. */
export function customProperties(declarations: readonly Declaration[]): Map<string, string> {
  return new Map(
    declarations.filter((d) => d.property.startsWith('--')).map((d) => [d.property, d.value]),
  );
}

/** A value with its var() references replaced by what they name, or undefined if one names
 *  nothing and has no fallback. */
export function resolve(
  value: string,
  vars: ReadonlyMap<string, string>,
  depth = 0,
): string | undefined {
  const call = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(value.trim());
  if (!call) return value.trim();
  if (depth > 8) return undefined;
  const [, name = '', fallback] = call;
  const named = vars.get(name);
  if (named !== undefined) return resolve(named, vars, depth + 1);
  return fallback === undefined ? undefined : resolve(fallback, vars, depth + 1);
}

/** A length's number, 0 for the keywords that add no tracking, or undefined if unreadable. */
export function trackingOf(value: string): number | undefined {
  const v = value.replace(/\s*!important$/i, '').trim();
  if (/^(normal|inherit|initial|unset|revert|revert-layer)$/i.test(v)) return 0;
  const length =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:em|rem|px|ch|ex|cap|ic|lh|rlh|%|pt|vw|vh)?$/i.exec(v);
  return length ? Number(length[1]) : undefined;
}

// ---------------------------------------------------------------------------------------------
// 1. Capitals and tracking

/** A rule that sets the label face, or a label's or a control's size: Barlow Semi Condensed. */
const LABEL = /--font-label\b|--text-(label|ui)\b/;
/** A token Tailwind's text-* and tracking-* utilities apply as letter-spacing. */
const TRACKING_TOKEN = /^--(text-[\w-]+--letter-spacing|tracking-[\w-]+)$/;

/**
 * Why a stylesheet sets text in capitals or tracks it, one line each. `vars` resolves the tokens
 * a letter-spacing names: the sources' own, or the build's.
 */
export function capitalsAndTracking(
  css: string,
  file: string,
  vars: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  const all = declarationsOf(css);
  const labels = new Set(
    all
      .filter((d) => /^font(-family|-size)?$/.test(d.property) && LABEL.test(d.value))
      .map((d) => d.block),
  );
  for (const d of all) {
    const where = `${file}:${d.line}`;
    if (d.property === 'text-transform' && /\buppercase\b/i.test(d.value))
      problems.push(`${where}: ${selectorOf(d)} sets text-transform: ${d.value}`);
    if (TRACKING_TOKEN.test(d.property)) {
      const amount = trackingOf(resolve(d.value, vars) ?? '');
      if (amount === undefined || amount > 0)
        problems.push(`${where}: ${d.property}: ${d.value}, tracking a utility class applies`);
    }
    if (d.property !== 'letter-spacing') continue;
    const resolved = resolve(d.value, vars);
    const amount = trackingOf(resolved ?? '');
    const shown = resolved !== undefined && resolved !== d.value ? ` (${resolved})` : '';
    if (amount === undefined)
      problems.push(`${where}: ${selectorOf(d)} sets letter-spacing: ${d.value}, unreadable`);
    else if (amount > 0)
      problems.push(
        `${where}: ${selectorOf(d)} tracks its letters, letter-spacing: ${d.value}${shown}`,
      );
    else if (amount !== 0 && labels.has(d.block))
      problems.push(`${where}: ${selectorOf(d)} is a label and sets letter-spacing: ${d.value}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// 2. A dot or an arrow between words

/** A dot set between words: the middle dot, and the bullets that do its job. */
const DOTS = '\u00b7\u2022\u2219\u22c5';
/** An arrow: the Arrows block (← ↑ → ↓ ↗ among them), the long arrows and the dingbat arrows. */
const ARROWS = '\u2190-\u21ff\u27f0-\u27ff\u2794-\u27bf';
const TELL = new RegExp(`[${DOTS}${ARROWS}]`, 'u');

/** What a character is, for a message. */
const nameOf = (c: string) => (DOTS.includes(c) ? `a dot (${c})` : `an arrow (${c})`);

/** The first dot or arrow in a text, named, or undefined. */
export function tellIn(text: string): string | undefined {
  const found = TELL.exec(text);
  return found ? nameOf(found[0]) : undefined;
}

/** A CSS string's characters, its escapes (\b7, \2192) read. */
const unescapeCss = (value: string) =>
  value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  );

/** Why a stylesheet's generated content draws a dot or an arrow, one line each. */
export function generatedTells(css: string, file: string): string[] {
  return declarationsOf(css).flatMap((d) => {
    const tell = d.property === 'content' ? tellIn(unescapeCss(d.value)) : undefined;
    return tell ? [`${file}:${d.line}: ${selectorOf(d)} draws ${tell}: content: ${d.value}`] : [];
  });
}

type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/** Attributes whose words a visitor reads or hears. */
const READ = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'placeholder',
  'title',
]);

const isElement = (node: Node): node is Element => 'tagName' in node;
const classes = (element: Element) =>
  (element.attrs.find((a) => a.name === 'class')?.value ?? '').split(/\s+/).filter(Boolean);
/** An element as a short name for a message: its tag and its first class. */
const short = (element: Element) =>
  `<${element.tagName}${classes(element)[0] ? `.${classes(element)[0]}` : ''}>`;

/**
 * The words a page shows outside a post's body: every text node in <body>, a <template>'s
 * included, and every attribute a visitor reads or hears, each with the element that holds it.
 * A .prose element, and scripts and styles, are not read.
 */
export function wordsOf(page: string): { words: string; where: string }[] {
  const found: { words: string; where: string }[] = [];
  const document = parse(page);
  const root = document.childNodes.find(isElement);
  const body = root?.childNodes.find((n): n is Element => isElement(n) && n.tagName === 'body');
  if (!body) return found;
  const walk = (node: ParentNode, holder: string) => {
    for (const child of node.childNodes) {
      if (child.nodeName === '#text' && 'value' in child) {
        if (child.value.trim()) found.push({ words: child.value.trim(), where: holder });
        continue;
      }
      if (!isElement(child)) continue;
      if (child.tagName === 'script' || child.tagName === 'style') continue;
      if (classes(child).includes('prose')) continue;
      const here = short(child);
      for (const attr of child.attrs)
        if (READ.has(attr.name) && attr.value.trim())
          found.push({ words: attr.value.trim(), where: `${here} ${attr.name}` });
      walk(
        child.tagName === 'template' ? (child as DefaultTreeAdapterTypes.Template).content : child,
        here,
      );
    }
  };
  walk(body, '<body>');
  return found;
}

/** Why a page's words hold a dot or an arrow outside a post's body, one line each. */
export function pageTells(page: string, file: string): string[] {
  return wordsOf(page).flatMap(({ words, where }) => {
    const tell = tellIn(words);
    return tell ? [`${file}: ${tell} in ${where}: "${words.slice(0, 60)}"`] : [];
  });
}

/** A line that may hold a dot: a page's <title> or its link preview's title, the browser's and
 *  other sites' labels for the page, as the <head> is above. */
const TITLE_LINE = /\btitle=\{|<title>|\bogTitle\b/;

/** Why a source file writes a dot or an arrow into a page's words, one line each: every line but
 *  a title's. The table of character entities (lib/held-names.ts) names them, and is not read. */
export function sourceTells(text: string, file: string): string[] {
  return text.split('\n').flatMap((line, i) => {
    const tell = TITLE_LINE.test(line) ? undefined : tellIn(line);
    return tell ? [`${file}:${i + 1}: ${tell}: ${line.trim().slice(0, 60)}`] : [];
  });
}

/** The sources whose words reach a page, at build or in the browser: every component, layout,
 *  library, page and script under src/, but the content, which is Joseph's. */
const SOURCE_DIRS = ['components', 'layouts', 'lib', 'pages', 'scripts'];
const sourceFiles = SOURCE_DIRS.flatMap((dir) =>
  readdirSync(join(app, 'src', dir), { recursive: true })
    .map(String)
    .filter((name) => /\.(astro|ts|js|mjs)$/.test(name))
    .map((name) => join('src', dir, name)),
).filter((file) => !file.endsWith(join('lib', 'held-names.ts')));

// ---------------------------------------------------------------------------------------------
// 3. Mono for code

/** A family list that names a monospaced face: the token, a self-hosted or a system mono. */
const MONO = /mono|courier|consolas|menlo/i;
/** The elements that are code. */
const CODE = new Set(['code', 'kbd', 'pre', 'samp']);

/** The element a selector styles: the type of its last compound, after its combinators. */
export function subjectOf(selector: string): string {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i] ?? '';
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) last = i + 1;
  }
  return /^[a-z][a-z0-9-]*/i.exec(selector.slice(last).trim())?.[0].toLowerCase() ?? '';
}

/** A selector list's selectors, split at the commas outside brackets. */
function selectorsIn(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === ',') {
      out.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(list.slice(from).trim());
  return out.filter(Boolean);
}

/** Why a stylesheet sets a monospaced face on something that is not code, one line each. */
export function monoOutsideCode(css: string, file: string): string[] {
  return declarationsOf(css).flatMap((d) => {
    if (!/^font(-family)?$/.test(d.property) || !MONO.test(d.value) || inFontFace(d)) return [];
    const strays = selectorsIn(selectorOf(d)).filter((s) => !CODE.has(subjectOf(s)));
    return strays.length > 0
      ? [`${file}:${d.line}: ${strays.join(', ')} sets ${d.property}: ${d.value}`]
      : [];
  });
}

/** Why a page sets a monospaced face by attribute (an SVG's font-family), one line each. */
export function monoAttributes(page: string, file: string): string[] {
  const found: string[] = [];
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      const family = child.attrs.find((a) => a.name === 'font-family')?.value;
      if (family && MONO.test(family) && !CODE.has(child.tagName))
        found.push(`${file}: ${short(child)} sets font-family="${family}"`);
      walk(
        child.tagName === 'template' ? (child as DefaultTreeAdapterTypes.Template).content : child,
      );
    }
  };
  walk(parse(page));
  return found;
}

// ---------------------------------------------------------------------------------------------
// What the checks read

const STYLES = join(app, 'src/styles');
const sources = readdirSync(STYLES)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ file: `src/styles/${name}`, css: readFileSync(join(STYLES, name), 'utf8') }));
const sourceVars = customProperties(sources.flatMap(({ css }) => declarationsOf(css)));

/** The build's stylesheets: every .css file it writes, and every <style> in a page it writes. */
const built = [
  ...files.filter((file) => file.endsWith('.css')).map((file) => ({ file, css: read(file) })),
  ...html.flatMap((file) =>
    [...read(file).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m, i) => ({
      file: `${file} <style> ${i + 1}`,
      css: m[1] ?? '',
    })),
  ),
];
const builtVars = customProperties(built.flatMap(({ css }) => declarationsOf(css)));

describe('labels are never capitals, never tracked', () => {
  test('src/styles sets no capitals, no tracking, and no letter-spacing on a label', () => {
    expect(sources.length).toBeGreaterThan(3);
    expect(sources.flatMap(({ css, file }) => capitalsAndTracking(css, file, sourceVars))).toEqual(
      [],
    );
  });

  test("the build's stylesheets, utilities included, set no capitals and no tracking", () => {
    expect(built.some(({ file }) => file.endsWith('.css'))).toBe(true);
    expect(built.flatMap(({ css, file }) => capitalsAndTracking(css, file, builtVars))).toEqual([]);
  });

  test('known answers: main before this wave fails, the system passes', () => {
    // From main at ffb6fe5: tokens.css, the eyebrow in global.css, a key's name, the Route Lab's
    // table caption and the Raft cluster's labels.
    const main = `
      @theme {
        --text-label: 0.6875rem; /* 11px: uppercase mono labels */
        --text-label--letter-spacing: 0.1em;
      }
      @layer components {
        .label {
          font-family: var(--font-mono);
          font-size: var(--text-label);
          letter-spacing: var(--text-label--letter-spacing);
          text-transform: uppercase;
        }
        .kv dt {
          font-family: var(--font-mono);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
      }
      .rl-table caption {
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .iso-label {
        letter-spacing: 0.12em;
      }`;
    const vars = customProperties(declarationsOf(main));
    expect(capitalsAndTracking(main, 'main.css', vars)).toEqual([
      'main.css:4: --text-label--letter-spacing: 0.1em, tracking a utility class applies',
      'main.css:10: .label tracks its letters, letter-spacing: var(--text-label--letter-spacing) (0.1em)',
      'main.css:11: .label sets text-transform: uppercase',
      'main.css:15: .kv dt tracks its letters, letter-spacing: 0.1em',
      'main.css:16: .kv dt sets text-transform: uppercase',
      'main.css:20: .rl-table caption tracks its letters, letter-spacing: 0.1em',
      'main.css:21: .rl-table caption sets text-transform: uppercase',
      'main.css:24: .iso-label tracks its letters, letter-spacing: 0.12em',
    ]);
    // What class="uppercase tracking-widest" in markup would ship, minified, as the build writes.
    const utilities =
      ':root,:host{--tracking-widest:.1em}.uppercase{text-transform:uppercase}' +
      '.tracking-widest{--tw-tracking:var(--tracking-widest);letter-spacing:var(--tracking-widest)}';
    expect(
      capitalsAndTracking(utilities, 'u.css', customProperties(declarationsOf(utilities))),
    ).toEqual([
      'u.css:1: --tracking-widest: .1em, tracking a utility class applies',
      'u.css:1: .uppercase sets text-transform: uppercase',
      'u.css:1: .tracking-widest tracks its letters, letter-spacing: var(--tracking-widest) (.1em)',
    ]);
    // A label set tighter is still tracked; a token nobody defines cannot be read as untracked.
    expect(
      capitalsAndTracking(
        '.a{font-family:var(--font-label);letter-spacing:-.01em}.b{letter-spacing:var(--x)}',
        'l.css',
        new Map(),
      ),
    ).toEqual([
      'l.css:1: .a is a label and sets letter-spacing: -.01em',
      'l.css:1: .b sets letter-spacing: var(--x), unreadable',
    ]);
    // The system: a title tightened in the display face, a label set back to 0, Tailwind's
    // preflight, and words that only name the property in a comment or a string.
    const system = `
      .page-title { font-family: var(--font-display); letter-spacing: -0.005em; }
      .figure-words { font-family: var(--font-label); letter-spacing: 0; }
      button, input { letter-spacing: inherit; }
      .x::after { content: 'text-transform: uppercase'; } /* letter-spacing: 0.1em */
      .lowercase { text-transform: lowercase; }`;
    expect(capitalsAndTracking(system, 's.css', new Map())).toEqual([]);
  });
});

describe('no dot and no arrow in what a page says, outside a post’s body', () => {
  test('every page of this build', () => {
    expect(html.length).toBeGreaterThan(0);
    expect(html.flatMap((file) => pageTells(read(file), file))).toEqual([]);
  });

  test("no stylesheet draws one as generated content, in src/styles or in the build's", () => {
    expect([...sources, ...built].flatMap(({ css, file }) => generatedTells(css, file))).toEqual(
      [],
    );
  });

  test("no source writes one into a page's words, at build or from a script", () => {
    expect(sourceFiles.length).toBeGreaterThan(40);
    expect(
      sourceFiles.flatMap((file) => sourceTells(readFileSync(join(app, file), 'utf8'), file)),
    ).toEqual([]);
  });

  test('known answers: the sources check finds main’s Raft Lab clock and passes a title', () => {
    // components/raft-lab/RaftLab.astro on main at ffb6fe5, and its route-lab format's readout.
    expect(
      sourceTells(
        "<span data-rf-clock>Virtual time {seconds(sim.now)}</span> · seed{' '}\n" +
          'return `${miles} mi · ${vans} vans`;',
        'main.astro',
      ),
    ).toEqual([
      'main.astro:1: a dot (·): <span data-rf-clock>Virtual time {seconds(sim.now)}</span> ·',
      'main.astro:2: a dot (·): return `${miles} mi · ${vans} vans`;',
    ]);
    expect(sourceTells('  title={`${entry.title} · ${name}`}', 'demo.astro')).toEqual([]);
  });

  test('every page is read: its links, buttons and labels are found, so no page passes unread', () => {
    for (const file of html) {
      const words = wordsOf(read(file));
      expect(words.length, file).toBeGreaterThan(10);
      expect(
        words.some(({ where }) => where.startsWith('<a')),
        file,
      ).toBe(true);
    }
  });

  test('known answers: main before this wave fails, the system passes', () => {
    // Main's pages at ffb6fe5, as its build wrote them: the rail's "View all" link, the hero's
    // buttons and location, Home's scene caption, the Raft cluster's label, a post's meta line in a
    // list and in its page head, and the command menu's help.
    const page = (body: string) =>
      `<!doctype html><html><head><title>Lab · Joseph Peterson</title></head><body>${body}</body></html>`;
    const main = page(
      '<li class="nav-all"><a href="/lab/">View all demos <span aria-hidden="true">→</span></a></li>' +
        '<p class="where">US · remote</p>' +
        '<a class="btn" href="#work">Work <span class="hint" aria-hidden="true">↓</span></a>' +
        '<a class="btn" href="https://www.linkedin.com/" rel="me">LinkedIn <span class="hint" aria-hidden="true">↗</span></a>' +
        '<figcaption class="scene-hud"><p class="scene-hud-row label">20 orders · 3 vans · planned by VROOM</p></figcaption>' +
        '<svg><text class="iso-label" data-say="lead-1">LEADER · TERM 3</text></svg>' +
        '<p class="post-meta"><time datetime="2026-10-25">2026-10-25</time> · Postmortem</p>' +
        '<header class="page-head"><p class="post-meta"><time datetime="2026-10-25">2026-10-25</time> · security, testing</p></header>' +
        '<dialog class="palette"><p class="palette-help">↑/↓ move · enter open · esc close</p></dialog>',
    );
    expect(pageTells(main, 'main.html')).toEqual([
      'main.html: an arrow (→) in <span>: "→"',
      'main.html: a dot (·) in <p.where>: "US · remote"',
      'main.html: an arrow (↓) in <span.hint>: "↓"',
      'main.html: an arrow (↗) in <span.hint>: "↗"',
      'main.html: a dot (·) in <p.scene-hud-row>: "20 orders · 3 vans · planned by VROOM"',
      'main.html: a dot (·) in <text.iso-label>: "LEADER · TERM 3"',
      'main.html: a dot (·) in <p.post-meta>: "· Postmortem"',
      'main.html: a dot (·) in <p.post-meta>: "· security, testing"',
      'main.html: an arrow (↑) in <p.palette-help>: "↑/↓ move · enter open · esc close"',
    ]);
    // Main's résumé drew a dot between skills from the stylesheet.
    expect(
      generatedTells(
        ".resume .skills > div:not(:last-child)::after {\n  content: '·';\n}",
        'main.css',
      ),
    ).toEqual([
      "main.css:2: .resume .skills > div:not(:last-child)::after draws a dot (·): content: '·'",
    ]);
    expect(
      generatedTells('.a::before{content:\'\\2190\'}.b::after{content:"\\b7 "}', 'e.css'),
    ).toEqual([
      "e.css:1: .a::before draws an arrow (←): content: '\\2190'",
      'e.css:1: .b::after draws a dot (·): content: "\\b7 "',
    ]);
    // Words a visitor hears count: an arrow in a link's name is read aloud.
    expect(pageTells(page('<a href="/" aria-label="Back ← home">Home</a>'), 'a.html')).toEqual([
      'a.html: an arrow (←) in <a> aria-label: "Back ← home"',
    ]);
    // The system: the same places in words, a post's body as Joseph wrote it, a template's
    // words, and the document's <head>.
    const system = page(
      '<li class="nav-all"><a href="/lab/">View all demos</a></li>' +
        '<p class="hero-title">Senior Software Engineer. Remote, US.</p>' +
        '<p class="post-meta"><time datetime="2026-10-25">25 October 2026</time>, postmortem</p>' +
        '<p class="palette-help">Up and down to move, Enter to open, Esc to close</p>' +
        '<div class="prose"><p>Cost · latency → a tradeoff, <a href="#fn-1">↑</a></p></div>' +
        '<template><span>Virtual time 1.400 s, seed 7</span></template>',
    );
    expect(pageTells(system, 's.html')).toEqual([]);
    expect(pageTells(page('<template><span>A · B</span></template>'), 't.html')).toEqual([
      't.html: a dot (·) in <span>: "A · B"',
    ]);
    // An entity is read as the character it names, as a browser reads it.
    expect(pageTells(page('<p>Lab &middot; Home</p>'), 'e.html')).toEqual([
      'e.html: a dot (·) in <p>: "Lab · Home"',
    ]);
  });
});

describe('mono sets code and nothing else', () => {
  test('src/styles sets a monospaced face only on code', () => {
    expect(sources.flatMap(({ css, file }) => monoOutsideCode(css, file))).toEqual([]);
  });

  test("the build's stylesheets and pages set a monospaced face only on code", () => {
    expect(built.flatMap(({ css, file }) => monoOutsideCode(css, file))).toEqual([]);
    expect(html.flatMap((file) => monoAttributes(read(file), file))).toEqual([]);
  });

  test('the build sets code in mono: the check reads the rule it allows', () => {
    const allowed = built.flatMap(({ css }) =>
      declarationsOf(css).filter((d) => d.property === 'font-family' && MONO.test(d.value)),
    );
    expect(allowed.some((d) => selectorsIn(selectorOf(d)).includes('.prose code'))).toBe(true);
  });

  test('known answers: main before this wave fails, the system passes', () => {
    // From main at ffb6fe5: the eyebrow, a key's value, the Raft Lab's terms, and what
    // class="font-mono" would ship.
    const main = `
      .label { font-family: var(--font-mono); }
      .kv dd { margin: 0; font-family: var(--font-mono); }
      .rf-term { fill: var(--muted-foreground); font-family: var(--font-mono); }
      .font-mono{font-family:var(--font-mono)}`;
    expect(monoOutsideCode(main, 'main.css')).toEqual([
      'main.css:2: .label sets font-family: var(--font-mono)',
      'main.css:3: .kv dd sets font-family: var(--font-mono)',
      'main.css:4: .rf-term sets font-family: var(--font-mono)',
      'main.css:5: .font-mono sets font-family: var(--font-mono)',
    ]);
    // One stray selector in a list is named; a system mono by name counts as mono.
    expect(
      monoOutsideCode('code, .value { font: 500 1rem ui-monospace, monospace }', 'l.css'),
    ).toEqual(['l.css:1: .value sets font: 500 1rem ui-monospace, monospace']);
    expect(
      monoAttributes('<svg><text font-family="JetBrains Mono">LEADER</text></svg>', 'p.html'),
    ).toEqual(['p.html: <text> sets font-family="JetBrains Mono"']);
    // The system: code in a post, Tailwind's preflight, the fitted fallback faces, and the
    // token's definition.
    const system = `
      .prose code { font-family: var(--font-mono); font-size: 0.84em; }
      .prose :not(pre) > code, .prose pre code { font-family: var(--font-mono); }
      code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)}
      @font-face { font-family: 'B612 Mono Fallback Menlo'; src: local('Menlo'); }
      @theme { --font-mono: var(--font-b612-mono, var(--font-mono-fallbacks)), var(--font-mono-fallbacks); }
      .rail-search kbd { font-family: var(--font-label); }`;
    expect(monoOutsideCode(system, 's.css')).toEqual([]);
  });
});

describe('reading a stylesheet: known answers', () => {
  test('declarations keep their line, their rule and the preludes around them', () => {
    const css = `/* a { color: red; } */
@media (min-width: 64rem) {
  .a:not(.b, .c),
  .d[data-x='{;}'] {
    content: ';}';
    color: var(--x, red);
  }
}
.e{margin:0}`;
    expect(
      declarationsOf(css).map((d) => [d.line, d.block, d.within.join(' | '), d.property, d.value]),
    ).toEqual([
      [5, 1, "@media (min-width: 64rem) | .a:not(.b, .c),\n  .d[data-x='{;}']", 'content', "';}'"],
      [
        6,
        1,
        "@media (min-width: 64rem) | .a:not(.b, .c),\n  .d[data-x='{;}']",
        'color',
        'var(--x, red)',
      ],
      [9, 2, '.e', 'margin', '0'],
    ]);
  });

  test('a token resolves through its fallbacks; a length reads as a number', () => {
    const vars = new Map([
      ['--a', 'var(--b)'],
      ['--b', '0.1em'],
    ]);
    expect(resolve('var(--a)', vars)).toBe('0.1em');
    expect(resolve('var(--none, var(--b))', vars)).toBe('0.1em');
    expect(resolve('var(--none)', vars)).toBeUndefined();
    expect(trackingOf('.1em')).toBe(0.1);
    expect(trackingOf('-0.005em')).toBe(-0.005);
    expect(trackingOf('0')).toBe(0);
    expect(trackingOf('normal')).toBe(0);
    expect(trackingOf('calc(1em / 10)')).toBeUndefined();
    expect(subjectOf('.prose :not(pre) > code')).toBe('code');
    expect(subjectOf('code.x::selection')).toBe('code');
    expect(subjectOf('.rail-search kbd')).toBe('kbd');
    expect(subjectOf('.kv dd')).toBe('dd');
    expect(subjectOf('.label')).toBe('');
  });
});
