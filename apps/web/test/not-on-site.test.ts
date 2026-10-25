import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findHeld, normalize, parseHolds, readingOf, UnreadableText } from '../src/lib/held-names';
import { app, files, read, textFiles } from './support/dist';

// The hold list (not-on-site.txt): names public in the repository but held off the site until a
// rule lifts. This scans every text file and every path the site serves. Binary files are covered
// elsewhere: the fonts' strings by fonts.test.ts, the Open Graph image's by og.test.ts, which
// requires every drawn word to be in the page's own text, and dist-files.test.ts fails on any file
// that is neither text nor one of those binaries.

const holds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));

test('the hold list parses, and every name says what holds it', () => {
  expect(holds.length).toBeGreaterThan(0);
  for (const hold of holds) expect(hold.reason.length, hold.name).toBeGreaterThan(10);
});

// Each file as its type is read: a script as JavaScript, everything else as markup (ADR 0016).
describe('no held name in any file the site serves', () => {
  for (const file of textFiles) {
    test(file, () => expect(findHeld(read(file), holds, readingOf(file))).toEqual([]));
  }
});

test('no held name in any path the site serves', () => {
  expect(files.flatMap((file) => findHeld(file, holds).map((name) => `${file}: ${name}`))).toEqual(
    [],
  );
});

// The list's own entries, spelled from their parts: no name is copied into this file, so lifting a
// hold never breaks a test, and the test reads whatever the list holds.
describe('every entry in the list catches its parts however they are joined', () => {
  const list = readFileSync(join(app, 'not-on-site.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  for (const [written = '', joins = ''] of list) {
    const parts = written.split(/[-_|]+/).filter(Boolean);
    const name = written.replace(/\|/g, '');
    test(`${name}: ${joins}`, () => {
      for (const glue of ['', '-', '_', '‑', '­', '&shy;', '<wbr>']) {
        for (const text of [parts.join(glue), parts.map((p) => p.toUpperCase()).join(glue)]) {
          expect(findHeld(text, holds), JSON.stringify(text)).toContain(name);
        }
      }
      if (parts.length > 1) {
        const spaced = parts.join(' ');
        expect(findHeld(spaced, holds).includes(name), spaced).toBe(joins === 'any');
      }
    });
  }
});

// Known answers for the matcher, on throwaway names (the convention of scripts/firewall/test.sh):
// a name written with a hyphen, a one-word name whose spaced form is ordinary prose, and a one-word
// name whose spaced form is not. A matcher that passed any "caught" line would let that spelling
// ship.
describe('known answers: every spelling a reader would see is caught', () => {
  const c = String.fromCodePoint;
  const amp = '&';
  const sample = parseHolds(
    [
      'Zqvexo-QZ   any       throwaway: a name written with a hyphen',
      'zqmor|tam   no-space  throwaway: a one-word name whose spaced form is prose',
      'zqquil|mox  any       throwaway: a one-word name',
    ].join('\n'),
  );
  const [VEXO, MORTAM, QUILMOX] = ['Zqvexo-QZ', 'zqmortam', 'zqquilmox'];

  const caught: [string, string][] = [
    // case, and the joins the list allows
    ['Zqvexo-QZ', VEXO],
    ['zqvexo qz', VEXO],
    ['ZqvexoQZ', VEXO],
    ['ZQVEXO_QZ', VEXO],
    ['Zqvexo - QZ', VEXO],
    ['zqmortam', MORTAM],
    ['ZqMorTam', MORTAM],
    ['zqmor-tam', MORTAM],
    ['zqmor_tam', MORTAM],
    ['zqquilmox', QUILMOX],
    ['zqquil-mox', QUILMOX],
    ['ZqQuil Mox', QUILMOX],
    ['zqquil_mox', QUILMOX],
    ['Zqquil__-Mox', QUILMOX],
    // numeric references, with and without their ";", Windows-1252's dashes among them
    [`Zqvexo${amp}#8209;QZ`, VEXO],
    [`Zqvexo${amp}#x2011;QZ`, VEXO],
    [`Zqvexo${amp}#8209QZ`, VEXO],
    [`Zqvexo${amp}#150;QZ`, VEXO],
    [`zqmor${amp}#173tam`, MORTAM],
    [`${amp}#122qmortam`, MORTAM],
    // named references, and the legacy ones a browser reads without ";"
    [`Zq${amp}shy;vexo-QZ`, VEXO],
    [`zqmor${amp}shy;tam`, MORTAM],
    [`zqmor${amp}shytam`, MORTAM],
    [`zqquil${amp}ndash;mox`, QUILMOX],
    [`Zqvexo${amp}hyphen;QZ`, VEXO],
    // markup a browser does not show
    ['Zqvexo<wbr>QZ', VEXO],
    ['<b>Zqvexo</b>-QZ', VEXO],
    ['zqmor<span>tam</span>', MORTAM],
    ['zqquil<!-- a comment -->mox', QUILMOX],
    ['<p>zqquil<wbr>mox</p><p>Next paragraph</p>', QUILMOX],
    ['<li>zqmor<wbr>tam</li><li>another item</li>', MORTAM],
    ['<a href="/">Zqvexo</a>-QZ', VEXO],
    // typographic dashes and the minus sign
    [`Zqvexo${c(0x2010)}QZ`, VEXO],
    [`Zqvexo${c(0x2014)}QZ`, VEXO],
    [`Zqvexo${c(0x2212)}QZ`, VEXO],
    [`zqquil${c(0x2011)}mox`, QUILMOX],
    // invisible characters: every Default_Ignorable_Code_Point, not a hand-made list
    [`Zqvexo${c(0x200b)}QZ`, VEXO],
    [`Zq${c(0x00ad)}vexo-QZ`, VEXO],
    [`zqmor${c(0x2063)}tam`, MORTAM],
    [`zqmor${c(0x180e)}tam`, MORTAM],
    [`zqmor${c(0x034f)}tam`, MORTAM],
    [`zqmor${c(0xfeff)}tam`, MORTAM],
    // compatibility forms (NFKC): fullwidth letters
    [
      `${c(0xff3a)}${c(0xff51)}${c(0xff56)}${c(0xff45)}${c(0xff58)}${c(0xff4f)}-${c(0xff31)}${c(0xff3a)}`,
      VEXO,
    ],
    // inside an address, a URL and a path
    ['hello@zqvexo-qz.example', VEXO],
    ['https://example.com/zqquilmox', QUILMOX],
    ['zqmortam/index.html', MORTAM],
  ];
  for (const [text, name] of caught) {
    test(`caught: ${JSON.stringify(text)}`, () => expect(findHeld(text, sample)).toEqual([name]));
  }

  // Words that contain a part, or a name inside a longer word, are not the name.
  const passed = [
    'conzqvexo QZ',
    'Zqvexo-QZs',
    'zqvexo',
    'zqmor tam',
    'zqmor  tam',
    'azqmortam',
    'zqmortams',
    'dizqquilmox',
    'zqquilmoxy',
    `zqquil${amp}amp;mox`,
    // a paragraph that ends in one part and the next that starts with the other: two lines on screen
    '<p>A line that ends zqmor</p><p>tam starts the next</p>',
    'zqmor<br>tam',
  ];
  for (const text of passed) {
    test(`passed: ${JSON.stringify(text)}`, () => expect(findHeld(text, sample)).toEqual([]));
  }

  test('a reference the check cannot read fails the check instead of passing it', () => {
    for (const text of [
      `Zqvexo${amp}madeup;QZ`,
      `zqmor${amp}hyphentam`,
      `zqmor${amp}#x;tam`,
      `zqmor${amp}#;tam`,
      `zqmor${amp}SHY;tam`,
    ]) {
      expect(() => findHeld(text, sample), text).toThrow(UnreadableText);
    }
  });

  test('a script is read as JavaScript: "&&name" is code, and a name in it is still caught', () => {
    expect(readingOf('_astro/app.D0LdBgLQ.js')).toBe('script');
    expect(readingOf('lab/routes/solver/x/vroom.mjs')).toBe('script');
    expect(readingOf('index.html')).toBe('markup');
    expect(readingOf('llms.txt')).toBe('markup');
    expect(readingOf('_astro/route-data.Bgyelr6y.json')).toBe('markup');
    const minified = `let e=a${amp}${amp}document.body;`;
    expect(findHeld(minified, sample, 'script')).toEqual([]);
    expect(() => findHeld(minified, sample, 'markup')).toThrow(UnreadableText);
    expect(findHeld(`${minified}t.textContent="zqquil mox"`, sample, 'script')).toEqual([QUILMOX]);
    expect(findHeld(`a${amp}${amp}"ZQMORTAM"`, sample, 'script')).toEqual([MORTAM]);
    // A script may write this text into innerHTML, where "&shy;" is a soft hyphen: the markup view
    // decodes it, so the name is caught (until 2026-10-25 a script was read as written only).
    expect(findHeld(`zqmor${amp}shy;tam`, sample, 'script')).toEqual([MORTAM]);
  });

  // What a script writes through innerHTML, the browser reads as markup: tags joined away and
  // references decoded. A string escape is the character it names. Each probe passed the
  // as-written reading alone (security review, 2026-10-25).
  const bs = '\\';
  for (const text of [
    'x.innerHTML="zq<wbr>quil<b>mox</b>"',
    `x.innerHTML="${amp}#90;qquilmox"`,
    `x.textContent="${bs}u005Aqquilmox"`,
    `x.textContent="zq${bs}u{71}uil${bs}x6dox"`,
    `x.innerHTML="zqquil${bs}u003cwbr${bs}u003emox"`,
  ]) {
    test(`caught in a script, as the browser reads it: ${text}`, () => {
      expect(findHeld(text, sample, 'script')).toEqual([QUILMOX]);
      expect(findHeld(`let e=a${amp}${amp}b;${text}`, sample, 'script')).toEqual([QUILMOX]);
    });
  }
  test('passed: a script with no name in any view, whose "&" never fails it', () => {
    const text = `let e=a${amp}${amp}b;x.innerHTML="<b>quil</b>mox"+${amp}madeup;`;
    expect(findHeld(text, sample, 'script')).toEqual([]);
  });

  test('references decode once, as a browser decodes them', () => {
    expect(normalize(`${amp}amp;shy;`)).toBe(`${amp}shy;`);
    expect(normalize(`${amp}ampersand`)).toBe(`${amp}ersand`);
    expect(normalize(`${amp}#x2011AI`)).toBe(`${c(0x2011a)}I`);
    expect(normalize(`${amp}#0;`)).toBe(c(0xfffd));
  });

  test('a list line without its joins column is refused', () => {
    expect(() => parseHolds('Zqvexo-QZ a rule with no joins column')).toThrow(/any.*no-space/);
  });
});
