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
  // Barlow Condensed, Barlow Semi Condensed, Barlow and its SemiBold, and B612 Mono.
  expect(shipped.length).toBe(5);
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
  // The five faces the site serves, and the two the Open Graph images draw with.
  expect(committed.length).toBe(7);
  for (const path of committed) expect(lock.outputs[path], path).toBeDefined();
});

// A font is a binary the content firewall cannot read: Brotli hides the strings in a woff2, and a
// TrueType name table stores UTF-16. So the strings are read here, in every font the site serves
// and every font the repository holds, and each must be on its family's list; an extended-metadata
// or private block, or a table outside the outline and layout tables, is refused outright.
const BARLOW = 'Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)';
/** Each face's name strings, keyed by its family name as the font itself records it: every face
 *  is a static instance from google/fonts, whose family name carries the weight. */
const NAMES: Record<string, string[]> = {
  'Barlow Condensed SemiBold': [
    BARLOW,
    'Barlow Condensed SemiBold',
    'Regular',
    '1.408;TRBY;BarlowCondensed-SemiBold',
    'Barlow Condensed SemiBold',
    'Version 1.408',
    'BarlowCondensed-SemiBold',
  ],
  'Barlow Semi Condensed Medium': [
    BARLOW,
    'Barlow Semi Condensed Medium',
    'Regular',
    '1.408;TRBY;BarlowSemiCondensed-Medium',
    'Barlow Semi Condensed Medium',
    'Version 1.408',
    'BarlowSemiCondensed-Medium',
  ],
  Barlow: [
    BARLOW,
    'Barlow',
    'Regular',
    '1.408;TRBY;Barlow-Regular',
    'Barlow Regular',
    'Version 1.408',
    'Barlow-Regular',
  ],
  'Barlow SemiBold': [
    BARLOW,
    'Barlow SemiBold',
    'Regular',
    '1.408;TRBY;Barlow-SemiBold',
    'Barlow SemiBold',
    'Version 1.408',
    'Barlow-SemiBold',
  ],
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
    const ttf = readFileSync(join(app, 'src/og/fonts/barlow-condensed-semibold.ttf'));
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
  const barlow = [
    'Barlow Condensed SemiBold',
    'Barlow Semi Condensed Medium',
    'Barlow',
    'Barlow SemiBold',
  ].map((family) => byFamily[family]);
  const mono = byFamily['B612 Mono'];

  test('every face is a static instance: no axis, one weight per file', () => {
    expect(faces.map((font) => font.familyName).sort()).toEqual(Object.keys(NAMES).sort());
    for (const font of faces) expect(font.variationAxes, font.familyName).toEqual({});
  });

  const missing = (font: Font | undefined, text: string) =>
    [...text].filter((c) => !font?.hasGlyphForCodePoint(c.codePointAt(0) ?? 0));
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCodePoint(0x20 + i)).join('');

  test('each Barlow face covers Latin-1 and the punctuation the design sets', () => {
    for (const font of barlow) {
      expect(font, 'a Barlow face is missing').toBeDefined();
      expect(missing(font, `${ascii}àéñöüçÆß·©–—‘’“”…€`), font?.familyName).toEqual([]);
    }
  });

  test('B612 Mono covers what code is written in: ASCII, Latin-1 and its punctuation', () => {
    expect(missing(mono, `${ascii}àéñöüç·©–—‘’“”…`)).toEqual([]);
  });

  test('known answers: Barlow draws no arrow and no ⌘, so the design writes words and draws the key', () => {
    for (const font of barlow) expect(missing(font, '←↑→↓↗⌘')).toEqual([...'←↑→↓↗⌘']);
    expect(missing(mono, '⌘')).toEqual(['⌘']);
  });
});

// Spike S9 (roadmap.md): what the Fonts API writes into every page. A regression here would set
// the name in a fallback (no face) or load it late (no preload). Every page's first screen draws
// the three Barlow faces, so each is preloaded; Barlow SemiBold draws <strong> only, so it is
// declared and fetched where a page sets some. B612 Mono draws code and nothing else, so a page
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
      const condensed = fontFile(page, 'Barlow Condensed', 600);
      const semi = fontFile(page, 'Barlow Semi Condensed', 500);
      const regular = fontFile(page, 'Barlow', 400);
      expect(condensed, 'Barlow Condensed has an @font-face').toBeDefined();
      expect(semi, 'Barlow Semi Condensed has an @font-face').toBeDefined();
      expect(regular, 'Barlow has an @font-face').toBeDefined();
      expect(fontFile(page, 'Barlow', 600), "Barlow's SemiBold has an @font-face").toBeDefined();
      expect(preloads(page)).toEqual([condensed, semi, regular]);
      expect(fontFile(page, 'B612 Mono', 400) !== undefined, 'B612 Mono only with code').toBe(
        drawsCode(page),
      );
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
      face('Barlow Condensed', '/_astro/fonts/c.woff2', 600) +
      face('Barlow', '/_astro/fonts/r.woff2', 400) +
      face('Barlow', '/_astro/fonts/b.woff2', 600);
    expect(fontFile(page, 'Barlow Condensed', 600)).toBe('/_astro/fonts/c.woff2');
    // A family's name is matched whole: "Barlow" is not "Barlow Condensed".
    expect(fontFile(page, 'Barlow', 400)).toBe('/_astro/fonts/r.woff2');
    expect(fontFile(page, 'Barlow', 600)).toBe('/_astro/fonts/b.woff2');
    expect(fontFile(page, 'B612 Mono', 400)).toBeUndefined();
    expect(preloads(page + link('/_astro/fonts/c.woff2'))).toEqual(['/_astro/fonts/c.woff2']);
    expect(drawsCode('<p>Run <code>pnpm</code></p>')).toBe(true);
    expect(drawsCode('<p>Press <kbd>K</kbd></p>')).toBe(false);
  });
});

describe('the fallback faces', () => {
  const css = readFileSync(join(app, 'src/styles/font-fallbacks.css'), 'utf8');

  test('the condensed faces were fitted to the name profile.json holds now', () => {
    // Barlow Condensed's fallbacks fit the name's own widths; a new name needs
    // scripts/fonts/build.sh --write.
    expect(css).toContain(`fitted to "${profile.basics.name}"`);
  });

  test('every family in the fallback stacks has faces, and each stack ends in a generic family', () => {
    for (const stack of [
      '--font-display-fallbacks',
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
