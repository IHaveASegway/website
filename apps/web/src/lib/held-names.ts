// The hold list (not-on-site.txt): names that are public in the repository but held off the site
// until a rule lifts. A secret term never goes here; it belongs in the content firewall's private
// rules (AGENTS.md). This module parses the list and finds a name the way a reader would see it:
// in any case; with its parts joined by nothing, a hyphen, an underscore or (where the list allows)
// a space; behind an HTML character reference, with or without its ";"; split by markup such as
// <wbr> or <b>; with an invisible character (soft hyphen, zero-width characters, every other
// Default_Ignorable_Code_Point) or a typographic dash inside; or in a compatibility form such as a
// fullwidth letter (NFKC). Text the check cannot read fails it (UnreadableText) rather than
// passing unread: fail closed. A JavaScript file is read as JavaScript, in four views: as written;
// with its string escapes (\u0041, \u{41}, \x41) decoded, as the engine decodes them; and as the
// markup it may write through innerHTML, read as markup is, with its character references decoded
// and then with its tags removed too. Minified code is full of "&&name", which no markup reading
// can parse, so in those two views a "&" that starts no reference stays as written instead of
// failing (ADR 0016).

export interface Hold {
  /** The name as the list writes it, without its split markers. */
  readonly name: string;
  readonly reason: string;
  readonly pattern: RegExp;
}

/** Thrown when text holds something the check cannot read, so it fails closed. */
export class UnreadableText extends Error {}

/** How a held name's parts may be joined and still count as that name. */
export const JOINS = {
  // Nothing, or any run of spaces, hyphens and underscores: gitops, git-ops, git ops, Git_Ops.
  any: '[\\s_-]*',
  // Nothing, one hyphen or one underscore, but never a space: for a name whose spaced form is
  // ordinary English ("still here"), which the hold would otherwise refuse in any sentence.
  'no-space': '[_-]?',
} as const;

const isJoin = (value: string): value is keyof typeof JOINS => Object.hasOwn(JOINS, value);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One entry per line: the name, how its parts may join ("any" or "no-space"), then the rule that
 * holds it; # starts a comment. "-" and "_" split a name into parts where it is written with them,
 * and "|" marks where a name written as one word splits (still|here).
 */
export function parseHolds(text: string): Hold[] {
  return text.split('\n').flatMap((raw, index) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return [];
    const [, written = '', joins = '', reason = ''] = /^(\S+)\s+(\S+)\s+(\S.*)$/.exec(line) ?? [];
    const parts = written.split(/[-_|]+/).filter(Boolean);
    if (!reason || !isJoin(joins) || parts.length === 0) {
      throw new Error(
        `not-on-site.txt:${index + 1}: a name, then "any" or "no-space", then the rule that holds it`,
      );
    }
    const body = parts.map(escapeRegExp).join(JOINS[joins]);
    return [
      {
        name: written.replace(/\|/g, ''),
        reason,
        pattern: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'),
      },
    ];
  });
}

// Named references the check can read, with their exact case: HTML's names are case-sensitive.
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  AMP: '&',
  lt: '<',
  LT: '<',
  gt: '>',
  GT: '>',
  quot: '"',
  QUOT: '"',
  apos: "'",
  nbsp: ' ',
  shy: '­',
  hyphen: '‐',
  dash: '‐',
  ndash: '–',
  mdash: '—',
  minus: '−',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  copy: '©',
  COPY: '©',
  middot: '·',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  nearr: '↗',
};

// The names above that browsers also decode without the ";" (HTML's legacy references), so
// "still&shyhere" reads as "still&shy;here" does.
const LEGACY: ReadonlySet<string> = new Set([
  'amp',
  'AMP',
  'lt',
  'LT',
  'gt',
  'GT',
  'quot',
  'QUOT',
  'nbsp',
  'shy',
  'copy',
  'COPY',
  'middot',
]);

// Numeric references to 0x80-0x9F decode to Windows-1252's characters, as HTML specifies, so
// "&#150;" is an en dash, not a control character.
const WINDOWS_1252: Readonly<Record<number, number>> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

function fromCode(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  return String.fromCodePoint(WINDOWS_1252[code] ?? code);
}

/** Character references decoded as a browser decodes them in text: numeric ones with or without
 *  their ";", named ones from the table above, and legacy names without ";". Anything else that
 *  starts like a reference is unreadable, or, when `lenient`, left as written: a script's markup
 *  view, where most "&" is code (findHeld). */
export function decodeReferences(text: string, lenient = false): string {
  const reference = /&(#[xX][0-9a-fA-F]*|#\d*|[A-Za-z][A-Za-z0-9]*)(;?)/g;
  return text.replace(reference, (whole, body: string, semi: string) => {
    const unreadable = () => {
      if (lenient) return whole;
      throw new UnreadableText(`a reference the check cannot read: ${whole}`);
    };
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const digits = body.slice(hex ? 2 : 1);
      if (!digits) return unreadable();
      return fromCode(parseInt(digits, hex ? 16 : 10));
    }
    const value = ENTITIES[body];
    if (value !== undefined && (semi || LEGACY.has(body))) return value;
    // A legacy name without its ";" ends where the name does, and the rest is text: "&shyhere".
    for (let end = body.length - 1; end > 0; end--) {
      const prefix = body.slice(0, end);
      const legacy = ENTITIES[prefix];
      if (legacy !== undefined && LEGACY.has(prefix)) return legacy + body.slice(end) + semi;
    }
    return unreadable();
  });
}

/** JavaScript's string escapes decoded as the engine decodes them: \uXXXX (a surrogate pair joins
 *  into its character), \u{X...} and \xXX. An escaped backslash before them is decoded too, which
 *  can only show the matcher more, never less. */
export function decodeEscapes(text: string): string {
  return text.replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
    (_, point?: string, unit?: string, byte?: string) => {
      if (point !== undefined) {
        const code = parseInt(point, 16);
        return code > 0x10ffff ? '\ufffd' : String.fromCodePoint(code);
      }
      return String.fromCharCode(parseInt(unit ?? byte ?? '0', 16));
    },
  );
}

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** How a file's text is read: as markup, which every page, feed, sitemap and text file is, or as
 *  a script a browser runs, where "&" starts no reference. */
export type Reading = 'markup' | 'script';

/** The reading for a file the site serves, by its name: .js and .mjs are scripts. */
export const readingOf = (file: string): Reading => (/\.m?js$/i.test(file) ? 'script' : 'markup');

/** Text as the matcher reads it: references decoded (in markup), NFKC, every dash a hyphen, and
 *  every default-ignorable character (soft hyphen, zero-width characters, joiners, BOM ...)
 *  removed. */
export function normalize(text: string, reading: Reading = 'markup'): string {
  return (reading === 'markup' ? decodeReferences(text) : text)
    .replace(IGNORABLE, '')
    .normalize('NFKC')
    .replace(/[\p{Pd}−]/gu, '-')
    .replace(IGNORABLE, '');
}

// Elements a browser draws inside a line by default: their tags join the text around them, so
// "Mission<wbr>AI" and "<b>still</b>here" read as one word. Every other tag (a paragraph, a list
// item, a heading, a line break) separates the words on either side, as its box does on screen.
const INLINE: ReadonlySet<string> = new Set(
  'a abbr b bdi bdo cite code data del dfn em font i ins kbd mark nobr q s samp small span strong sub sup time tt u var wbr'.split(
    ' ',
  ),
);

/** The text a reader sees of some HTML, by each element's default display: inline tags and
 *  comments removed, every other tag a line break. CSS can change an element's display, so
 *  e2e/not-on-site.spec.ts reads what the browser actually draws as well. */
export function withoutMarkup(html: string): string {
  return html.replace(
    /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g,
    (tag, name: string | undefined) =>
      tag.startsWith('<!--') || INLINE.has((name ?? '').toLowerCase()) ? '' : '\n',
  );
}

/** The ways a text is read, each normalized. Markup twice: as written, which covers attribute
 *  values, scripts and styles, and as a reader sees it, with its markup removed. A script four
 *  times: as written; with its string escapes decoded; and, from that, as the markup it may write,
 *  both ways markup is read, with references decoded leniently (decodeReferences). */
export function views(text: string, reading: Reading = 'markup'): string[] {
  if (reading === 'markup') return [normalize(text), normalize(withoutMarkup(text))];
  const decoded = decodeEscapes(text);
  return [
    normalize(text, 'script'),
    normalize(decoded, 'script'),
    normalize(decodeReferences(decoded, true), 'script'),
    normalize(decodeReferences(withoutMarkup(decoded), true), 'script'),
  ];
}

/** The held names a text contains, each once, in any of its views. */
export function findHeld(
  text: string,
  holds: readonly Hold[],
  reading: Reading = 'markup',
): string[] {
  const seen = views(text, reading);
  return holds
    .filter((hold) => seen.some((view) => new RegExp(hold.pattern).test(view)))
    .map((hold) => hold.name);
}
