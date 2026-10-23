import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { create, type Font } from 'fontkitten';
import { describe, expect, test } from 'vitest';
import { app, bytes, files, html, kinds, profile, read } from './support/dist';

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
  expect(shipped.length).toBe(2);
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
  '.astro',
  '.wrangler',
  'test-results',
  'playwright-report',
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
  expect(committed.length).toBe(4);
  for (const path of committed) expect(lock.outputs[path], path).toBeDefined();
});

// A font is a binary the content firewall cannot read: Brotli hides the strings in a woff2, and a
// TrueType name table stores UTF-16. So the strings are read here, in every font the site serves
// and every font the repository holds, and each must be on its family's list; an extended-metadata
// or private block, or a table outside the outline and layout tables, is refused outright.
const NAMES: Record<string, string[]> = {
  'Instrument Sans': [
    'Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans)',
    'Instrument Sans',
    'Regular',
    '1.000;NONE;InstrumentSans-Regular',
    'Instrument Sans Regular',
    'Version 1.000;gftools[0.9.28]',
    'InstrumentSans-Regular',
    'Width',
    'Weight',
    'Regular',
    'Medium',
    'SemiBold',
    'Bold',
    'Condensed',
    'SemiCondensed',
    'Normal',
    'Italic',
    'Roman',
  ],
  'JetBrains Mono': [
    'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)',
    'JetBrains Mono',
    'Regular',
    '2.304;JB;JetBrainsMono-Regular',
    'JetBrains Mono Regular',
    'Version 2.304',
    'JetBrainsMono-Regular',
    'Weight',
    'Regular',
    'Medium',
    'Italic',
    'Roman',
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
    const real = readFileSync(join(app, 'src/assets/fonts/jetbrains-mono-c.woff2'));
    expect(fontProblems(real)).toEqual([]);
    const privateBlock = Buffer.from(real);
    privateBlock.writeUInt32BE(1, 44);
    expect(fontProblems(privateBlock)).toContain('a WOFF2 metadata or private block');
    const ttf = readFileSync(join(app, 'src/og/fonts/instrument-sans-80-620.ttf'));
    // The same bytes with one name string changed: "Weight" becomes "Wxight", in UTF-16.
    const at = ttf.indexOf(Buffer.from('Weight', 'utf16le').swap16());
    expect(at).toBeGreaterThan(0);
    const renamed = Buffer.from(ttf);
    renamed.write('x', at + 3, 'latin1');
    expect(fontProblems(renamed)).toContain('name: "Wxight"');
    // The table directory with "gasp" renamed "meta", a table that can carry any data.
    const tagAt = ttf.indexOf(Buffer.from('gasp', 'latin1'));
    expect(tagAt).toBeGreaterThan(0);
    const retagged = Buffer.from(ttf);
    retagged.write('meta', tagAt, 'latin1');
    expect(fontProblems(retagged)).toContain('table: meta');
  });
});

describe('axes and coverage', () => {
  const byFamily = Object.fromEntries(
    shipped.map((file) => [open(bytes(file)).familyName, open(bytes(file))]),
  );
  const sans = byFamily['Instrument Sans'];
  const mono = byFamily['JetBrains Mono'];

  test('Instrument Sans keeps both axes: width 75-100 for the condensed name, weight 400-700', () => {
    expect(sans?.variationAxes['wdth']).toMatchObject({ min: 75, max: 100 });
    expect(sans?.variationAxes['wght']).toMatchObject({ min: 400, max: 700 });
  });

  test('JetBrains Mono keeps weight 400-500, the two weights direction C sets', () => {
    expect(mono?.variationAxes['wght']).toMatchObject({ min: 400, max: 500 });
  });

  const has = (font: typeof sans, text: string) =>
    [...text].filter((c) => !font?.hasGlyphForCodePoint(c.codePointAt(0) ?? 0));

  test('the sans covers Latin and the arrows the design sets in it', () => {
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCodePoint(0x20 + i)).join('');
    expect(has(sans, `${ascii}·©–—‘’“”…→↓↗`)).toEqual([]);
  });

  test('the mono subset covers everything C sets in mono, ⌘ included', () => {
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCodePoint(0x20 + i)).join('');
    expect(has(mono, `${ascii}·©–—‘’“”…←↑→↓↗⌘`)).toEqual([]);
  });
});

// Spike S9 (roadmap.md): what the Fonts API writes into every page. A regression here would
// render the name at full width (no stretch range) or load the fonts late (no preload).
describe('what the Fonts API writes into every page', () => {
  for (const file of html) {
    test(file, () => {
      const page = read(file);
      expect(page).toMatch(/@font-face\{[^}]*font-weight:400 700;[^}]*font-stretch:75% 100%;/);
      expect(page).toMatch(/@font-face\{[^}]*font-weight:400 500;/);
      expect(
        page.match(
          /<link rel="preload" href="\/_astro\/fonts\/[^"]+\.woff2" as="font" type="font\/woff2" crossorigin>/g,
        ),
      ).toHaveLength(2);
    });
  }
});

describe('the fallback faces', () => {
  const css = readFileSync(join(app, 'src/styles/font-fallbacks.css'), 'utf8');

  test('the condensed faces were fitted to the name profile.json holds now', () => {
    // The 75-85% faces fit the name's own widths; a new name needs scripts/fonts/build.sh --write.
    expect(css).toContain(`fitted to "${profile.basics.name}"`);
  });

  test('every family in the fallback stacks has faces, and each stack ends in a generic family', () => {
    for (const stack of ['--font-sans-fallbacks', '--font-mono-fallbacks']) {
      const value = new RegExp(`${stack}:([^;]+);`).exec(css)?.[1] ?? '';
      const families = value.split(',').map((family) => family.trim().replace(/^'|'$/g, ''));
      expect(['sans-serif', 'monospace']).toContain(families.at(-1));
      for (const family of families.slice(0, -1)) {
        expect(css, family).toContain(`font-family: '${family}';`);
      }
    }
  });
});
