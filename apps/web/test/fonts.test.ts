import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { create, type Font } from 'fontkitten';
import { describe, expect, test } from 'vitest';
import { app, bytes, files, fixture, html, kinds, profile, read } from './support/dist';

// The self-hosted fonts (design-system.md, "Typography"). scripts/fonts/build.sh is their one
// writer and fonts.lock.json its record; these checks run on every build, without the network.

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** A font file, read with fontkitten; a collection (.ttc) is not one of ours. */
function open(data: Buffer): Font {
  const font = create(data);
  if (font.isCollection) throw new Error('a font collection, not a font');
  return font;
}
const lock = JSON.parse(readFileSync(join(app, 'scripts/fonts/fonts.lock.json'), 'utf8')) as {
  outputs: Record<string, { sha256: string; bytes: number }>;
};

describe('every output matches fonts.lock.json', () => {
  test('the lock records outputs', () =>
    expect(Object.keys(lock.outputs).length).toBeGreaterThan(0));
  for (const [path, entry] of Object.entries(lock.outputs)) {
    test(path, () => {
      const data = readFileSync(join(app, path));
      expect({ sha256: sha256(data), bytes: data.byteLength }).toEqual(entry);
    });
  }
});

/** The fonts the site serves, found by their bytes (support/dist.ts), not by their names. */
const shipped = files.filter((file) => kinds.get(file) === 'woff2');

test('every font the site serves is a locked output, byte for byte', () => {
  const locked = new Set(Object.values(lock.outputs).map((entry) => entry.sha256));
  // Archivo ExtraCondensed ExtraBold, Condensed SemiBold, Expanded Medium, Regular and SemiBold,
  // and B612 Mono.
  expect(shipped.length).toBe(6);
  for (const file of shipped) expect(locked.has(sha256(bytes(file))), file).toBe(true);
});

// Every font file in the repository, found by its first bytes wherever it sits: the faces the site
// serves (src/assets/fonts) and the static instances the Open Graph images draw with (src/og/fonts).
// The firewall cannot read any of them either, and a committed font reaches history before it
// reaches dist/.
const FONT_SIGNATURES = ['wOF2', 'wOFF', 'OTTO', 'true', 'ttcf', '\u0000\u0001\u0000\u0000'];
const repository = join(app, '../..');
const NOT_SOURCE = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-preview', // the build with drafts: output, like dist/
  '.fixtures', // the test-only fixture builds: build output, like dist/
  '.astro',
  '.wrangler',
  'test-results',
  'test-results-writing',
  'playwright-report',
  'playwright-report-writing',
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (NOT_SOURCE.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}

function startsLikeAFont(path: string): boolean {
  const head = Buffer.alloc(4);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, head, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  return FONT_SIGNATURES.includes(head.toString('latin1'));
}

const committed = sources(repository)
  .filter(startsLikeAFont)
  .map((path) => relative(app, path).split(sep).join('/'));

test('every font in the repository is a locked output of scripts/fonts/build.sh', () => {
  // The six faces the site serves, and the two the Open Graph images draw with.
  expect(committed.length).toBe(8);
  for (const path of committed) expect(lock.outputs[path], path).toBeDefined();
});

// A font is a binary the content firewall cannot read: Brotli hides the strings in a woff2, and a
// TrueType name table stores UTF-16. So the strings are read here, in every font the site serves
// and every font the repository holds, and each must be on its family's list; an extended-metadata
// or private block, or a table outside the outline and layout tables, is refused outright.
const ARCHIVO =
  'Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)';
/** Each face's name strings, keyed by its family name as the font itself records it. The four
 *  Archivo faces are static instances scripts/fonts/cut.py cuts from google/fonts' variable font
 *  and names as themselves (ADR 0027); B612 Mono is google/fonts' own static instance. */
const archivo = (family: string, postscript: string, full = family): string[] => [
  ARCHIVO,
  family,
  'Regular',
  `2.001;OMNI;${postscript}`,
  full,
  'Version 2.001',
  postscript,
];
const NAMES: Record<string, string[]> = {
  'Archivo ExtraCondensed ExtraBold': archivo(
    'Archivo ExtraCondensed ExtraBold',
    'Archivo-ExtraCondensedExtraBold',
  ),
  'Archivo Condensed SemiBold': archivo('Archivo Condensed SemiBold', 'Archivo-CondensedSemiBold'),
  'Archivo Expanded Medium': archivo('Archivo Expanded Medium', 'Archivo-ExpandedMedium'),
  Archivo: archivo('Archivo', 'Archivo-Regular', 'Archivo Regular'),
  'Archivo SemiBold': archivo('Archivo SemiBold', 'Archivo-SemiBold'),
  'B612 Mono': [
    'Copyright 2012 The B612 Project Authors (https://github.com/polarsys/b612)',
    'B612 Mono',
    'Regular',
    'Airbus: B612 Mono Regular: Version1.008',
    'B612 Mono Regular',
    'Version 1.008',
    'B612Mono-Regular',
  ],
};

/** Every string in a name table, in every language it carries. */
function nameStrings(records: unknown): string[] {
  if (typeof records === 'string') return [records];
  if (records === null || typeof records !== 'object') return [];
  return Object.values(records).flatMap(nameStrings);
}

/** The tables a font of ours may hold: outlines, metrics, layout and variations. A table that can
 *  carry free data (meta, DSIG, Zapf, a vendor's own) fails the check. */
const TABLES = new Set(
  'GDEF GPOS GSUB HVAR MVAR OS/2 STAT avar cmap cvt fpgm fvar gasp glyf gvar head hhea hmtx loca maxp name post prep'.split(
    ' ',
  ),
);

/** What is wrong with a font file's strings and blocks; empty when nothing is. */
export function fontProblems(data: Buffer): string[] {
  const problems: string[] = [];
  if (data.toString('latin1', 0, 4) === 'wOF2') {
    // WOFF2 header: metaOffset, metaLength, metaOrigLength, privOffset, privLength.
    const fields = [28, 32, 36, 40, 44].map((at) => data.readUInt32BE(at));
    if (fields.some((value) => value !== 0)) problems.push('a WOFF2 metadata or private block');
  }
  const font = open(data);
  const expected = NAMES[font.familyName];
  if (!expected) return [...problems, `no name list for the family "${font.familyName}"`];
  const name = (font as unknown as { name: { records: unknown } }).name;
  const strings = nameStrings(name.records);
  problems.push(...strings.filter((s) => !expected.includes(s)).map((s) => `name: "${s}"`));
  if (!strings.includes(expected[0] ?? '')) problems.push('the copyright notice is missing');
  const tables = Object.keys(
    (font as unknown as { directory: { tables: Record<string, unknown> } }).directory.tables,
  );
  problems.push(...tables.filter((t) => !TABLES.has(t)).map((t) => `table: ${t}`));
  return problems;
}

describe("every font's strings and blocks, served or committed", () => {
  for (const file of shipped) {
    test(`dist/${file}`, () => expect(fontProblems(bytes(file))).toEqual([]));
  }
  for (const path of committed) {
    test(path, () => expect(fontProblems(readFileSync(join(app, path)))).toEqual([]));
  }

  test('the served faces carry their full name lists, so a cut that dropped one shows here', () => {
    for (const file of shipped) {
      const font = open(bytes(file));
      const name = (font as unknown as { name: { records: unknown } }).name;
      expect(nameStrings(name.records).sort(), file).toEqual(
        [...(NAMES[font.familyName] ?? [])].sort(),
      );
    }
  });

  test('known answers: a stray name string, a private block and a stray table are caught', () => {
    const real = readFileSync(join(app, 'src/assets/fonts/b612-mono-regular.woff2'));
    expect(fontProblems(real)).toEqual([]);
    const privateBlock = Buffer.from(real);
    privateBlock.writeUInt32BE(1, 44);
    expect(fontProblems(privateBlock)).toContain('a WOFF2 metadata or private block');
    const ttf = readFileSync(join(app, 'src/og/fonts/archivo-condensed-extrabold.ttf'));
    // The same bytes with one name string changed: "Regular" becomes "Rxgular", in UTF-16.
    const at = ttf.indexOf(Buffer.from('Regular', 'utf16le').swap16());
    expect(at).toBeGreaterThan(0);
    const renamed = Buffer.from(ttf);
    renamed.write('x', at + 3, 'latin1');
    expect(fontProblems(renamed)).toContain('name: "Rxgular"');
    // The table directory with "gasp" renamed "meta", a table that can carry any data.
    const tagAt = ttf.indexOf(Buffer.from('gasp', 'latin1'));
    expect(tagAt).toBeGreaterThan(0);
    const retagged = Buffer.from(ttf);
    retagged.write('meta', tagAt, 'latin1');
    expect(fontProblems(retagged)).toContain('table: meta');
  });
});

describe('axes and coverage', () => {
  const faces = shipped.map((file) => open(bytes(file)));
  const byFamily = Object.fromEntries(faces.map((font) => [font.familyName, font]));
  const archivoFaces = [
    'Archivo ExtraCondensed ExtraBold',
    'Archivo Condensed SemiBold',
    'Archivo Expanded Medium',
    'Archivo',
    'Archivo SemiBold',
  ].map((family) => byFamily[family]);
  const mono = byFamily['B612 Mono'];

  test('every face is a static instance: no axis, one weight per file', () => {
    expect(faces.map((font) => font.familyName).sort()).toEqual(Object.keys(NAMES).sort());
    for (const font of faces) expect(font.variationAxes, font.familyName).toEqual({});
  });

  const missing = (font: Font | undefined, text: string) =>
    [...text].filter((c) => !font?.hasGlyphForCodePoint(c.codePointAt(0) ?? 0));
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCodePoint(0x20 + i)).join('');

  test('each Archivo face covers Latin-1 and the punctuation the design sets', () => {
    for (const font of archivoFaces) {
      expect(font, 'an Archivo face is missing').toBeDefined();
      expect(missing(font, `${ascii}àéñöüçÆß·©–—‘’“”…€`), font?.familyName).toEqual([]);
    }
  });

  test('B612 Mono covers what code is written in: ASCII, Latin-1 and its punctuation', () => {
    expect(missing(mono, `${ascii}àéñöüç·©–—‘’“”…`)).toEqual([]);
  });

  // The cut keeps Google Fonts' latin range, which holds the up and down arrows (U+2191, U+2193)
  // and no other: Archivo draws those two, and the design sets none (test/tells.test.ts).
  test('known answers: no face draws a sideways arrow or ⌘, so the design writes words and draws the key', () => {
    for (const font of archivoFaces) expect(missing(font, '←→↗⌘')).toEqual([...'←→↗⌘']);
    expect(missing(mono, '⌘')).toEqual(['⌘']);
  });
});

// Spike S9 (roadmap.md): what the Fonts API writes into every page. A regression here would set
// the name in a fallback (no face) or load it late (no preload). Every page's first screen draws
// four of Archivo's faces, the display, wide, label and reading faces, so each is preloaded;
// Archivo SemiBold draws <strong> only, so it is declared and fetched where a page sets some. B612
// Mono draws code and nothing else, so a page
// declares it exactly when it has code (Prose.astro): until 2026-10-30 every page declared the mono
// face, and the Route Lab's first view counted a face it never drew (design-system.md, "The
// faces").
describe('what the Fonts API writes into every page', () => {
  /** The file each @font-face of a family names, and every file a page preloads. */
  const fontFile = (page: string, family: string, weight: number) =>
    new RegExp(
      `@font-face\\{font-family:"?${family}-[0-9a-f]+"?;src:url\\("([^"]+)"\\)[^}]*font-weight:${weight};`,
    ).exec(page)?.[1];
  const preloads = (page: string) =>
    [
      ...page.matchAll(
        /<link rel="preload" href="(\/_astro\/fonts\/[^"]+\.woff2)" as="font" type="font\/woff2" crossorigin>/g,
      ),
    ].map(([, href]) => href);
  /** Whether a page draws code: a code span or a code block anywhere in it. */
  const drawsCode = (page: string) => /<(code|pre)\b/.test(page);

  for (const file of html) {
    test(file, () => {
      const page = read(file);
      const display = fontFile(page, 'Archivo Display', 800);
      const wide = fontFile(page, 'Archivo Wide', 500);
      const label = fontFile(page, 'Archivo Label', 600);
      const regular = fontFile(page, 'Archivo', 400);
      expect(display, 'Archivo Display has an @font-face').toBeDefined();
      expect(wide, 'Archivo Wide has an @font-face').toBeDefined();
      expect(label, 'Archivo Label has an @font-face').toBeDefined();
      expect(regular, 'Archivo has an @font-face').toBeDefined();
      expect(fontFile(page, 'Archivo', 600), "Archivo's SemiBold has an @font-face").toBeDefined();
      expect(preloads(page)).toEqual([display, wide, label, regular]);
      expect(fontFile(page, 'B612 Mono', 400) !== undefined, 'B612 Mono only with code').toBe(
        drawsCode(page),
      );
      // A preloaded face is optional, never swapped in late; a face fetched on demand swaps
      // (astro.config.mjs, PRELOADED; e2e/steady.spec.ts).
      const preloaded = preloads(page);
      for (const [, src, display] of page.matchAll(
        /@font-face\{[^}]*src:url\("([^"]+)"\)[^}]*font-display:(\w+);/g,
      ))
        expect(display, src).toBe(preloaded.includes(src ?? '') ? 'optional' : 'swap');
    });
  }

  // The writing fixture's posts carry code spans and blocks by design, so there the rule above meets
  // pages on both sides of it: a check that only ever saw pages without code would hold nothing.
  test.runIf(fixture?.includes('fixture-many') ?? false)(
    'a page with code is in this build, so the mono half of the rule is held too',
    () => {
      expect(html.filter((file) => drawsCode(read(file))).length).toBeGreaterThan(0);
    },
  );

  test('known answers: the preload is read from the link, and the face from its @font-face', () => {
    // The API quotes a family name with a space in it and writes a one-word name bare.
    const face = (family: string, src: string, weight: number) => {
      const name = family.includes(' ') ? `"${family}-0a1b"` : `${family}-0a1b`;
      return `<style>@font-face{font-family:${name};src:url("${src}") format("woff2");font-display:swap;font-weight:${weight};font-style:normal;}</style>`;
    };
    const link = (href: string) =>
      `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`;
    const page =
      face('Archivo Display', '/_astro/fonts/c.woff2', 800) +
      face('Archivo', '/_astro/fonts/r.woff2', 400) +
      face('Archivo', '/_astro/fonts/b.woff2', 600);
    expect(fontFile(page, 'Archivo Display', 800)).toBe('/_astro/fonts/c.woff2');
    // A family's name is matched whole: "Archivo" is not "Archivo Display".
    expect(fontFile(page, 'Archivo', 400)).toBe('/_astro/fonts/r.woff2');
    expect(fontFile(page, 'Archivo', 600)).toBe('/_astro/fonts/b.woff2');
    expect(fontFile(page, 'B612 Mono', 400)).toBeUndefined();
    expect(preloads(page + link('/_astro/fonts/c.woff2'))).toEqual(['/_astro/fonts/c.woff2']);
    expect(drawsCode('<p>Run <code>pnpm</code></p>')).toBe(true);
    expect(drawsCode('<p>Press <kbd>K</kbd></p>')).toBe(false);
  });
});

describe('the fallback faces', () => {
  const css = readFileSync(join(app, 'src/styles/font-fallbacks.css'), 'utf8');

  test('the condensed faces were fitted to the name profile.json holds now', () => {
    // Archivo ExtraCondensed's fallbacks fit the name's own widths; a new name needs
    // scripts/fonts/build.sh --write.
    expect(css).toContain(`fitted to "${profile.basics.name}"`);
  });

  test('every family in the fallback stacks has faces, and each stack ends in a generic family', () => {
    for (const stack of [
      '--font-display-fallbacks',
      '--font-wide-fallbacks',
      '--font-label-fallbacks',
      '--font-sans-fallbacks',
      '--font-mono-fallbacks',
    ]) {
      const value = new RegExp(`${stack}:([^;]+);`).exec(css)?.[1] ?? '';
      const families = value.split(',').map((family) => family.trim().replace(/^'|'$/g, ''));
      expect(['sans-serif', 'monospace']).toContain(families.at(-1));
      for (const family of families.slice(0, -1)) {
        expect(css, family).toContain(`font-family: '${family}';`);
      }
    }
  });
});
