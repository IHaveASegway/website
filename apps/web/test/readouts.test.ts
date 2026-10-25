import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { BUILD_HEADER, withBuildHeader } from '../src/lib/build.mjs';
import { html, read, textFiles } from './support/dist';

// Nothing on the page describes the site (design-system.md): no commit, no build date and no byte
// figure is shown to a reader, and no page carries one in its markup either. Which commit is live
// is a machine's question, answered by a response header, X-Build, that the build writes into
// dist/_headers for the deploy smoke (e2e/smoke.spec.ts). The byte budgets are still measured on
// every build (test/budgets.test.ts); they are just not printed.

/** The commit this checkout builds, read here from git, not from lib/build.mjs. */
const commit = (
  process.env['GITHUB_SHA'] ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
).trim();

/** The build's _headers: Workers reads it, and never serves it (e2e/smoke.spec.ts). */
const HEADERS = '_headers';

describe('the build header: which commit is live, for machines only', () => {
  test('_headers sends X-Build with the commit this checkout builds, once, on every path', () => {
    const rules = read(HEADERS);
    const lines = rules.split('\n');
    const header = lines.flatMap((line, i) => (line.includes(BUILD_HEADER) ? [i] : []));
    expect(header).toHaveLength(1);
    expect(lines[header[0] ?? 0]).toBe(`  X-Build: ${commit}`);
    // It belongs to the "/*" rule, the one every response matches.
    expect(lines[(header[0] ?? 0) - 1]).toBe('/*');
  });

  test('no page names the commit, in <head> or anywhere else, in full or short', () => {
    for (const file of html) expect(read(file), file).not.toMatch(/<meta name="build"/);
    for (const file of textFiles.filter((f) => f !== HEADERS)) {
      expect(read(file).includes(commit.slice(0, 7)), file).toBe(false);
    }
  });

  test('known answers: the header joins the "/*" rule, and a file without one is refused', () => {
    const sha = 'a'.repeat(40);
    expect(withBuildHeader('# c\n/*\n  A: b\n\n/x\n  C: d\n', sha)).toBe(
      `# c\n/*\n  X-Build: ${sha}\n  A: b\n\n/x\n  C: d\n`,
    );
    expect(() => withBuildHeader('/x\n  C: d\n', sha)).toThrow(/no "\/\*" rule/);
  });
});

/** What a reader can see of a page: its body's text, without markup, scripts or JSON-LD. */
function visibleText(page: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/.exec(page)?.[1] ?? '';
  return body
    .replace(/<script\b[\s\S]*?<\/script>/g, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** A figure about bytes, as a readout or a card would print one: "0.8 KB", "64,140 B". */
const BYTE_FIGURE = /\b\d[\d,.]*\s?(?:[kKMG]i?B|B|bytes?)\b/;
/** A build readout: "Build 8c2067e", "built 2026-10-24", "commit cd5f2f7". */
const BUILD_READOUT = /\b(?:build|built|commit)\s*:?\s+(?:[0-9a-f]{7,40}|\d{4}-\d{2}-\d{2})\b/i;

describe('nothing on the page describes the site', () => {
  for (const file of ['index.html', '404.html']) {
    test(`${file} shows no byte figure, no build readout and no card about this site`, () => {
      const text = visibleText(read(file));
      expect(BYTE_FIGURE.exec(text)?.[0] ?? null, file).toBeNull();
      expect(BUILD_READOUT.exec(text)?.[0] ?? null, file).toBeNull();
      expect(text, file).not.toContain('This site');
      expect(read(file), file).not.toMatch(/class="readouts?"/);
    });
  }

  test('known answers: what the checks catch, and what they let through', () => {
    for (const sample of [
      'JavaScript 0.8 KB',
      'Fonts 64.1 KB, self-hosted',
      '6,420 B',
      '120 bytes',
    ])
      expect(BYTE_FIGURE.test(sample), sample).toBe(true);
    for (const sample of ['Build 8c2067e', 'built 2026-10-24', 'commit: cd5f2f70522d'])
      expect(BUILD_READOUT.test(sample), sample).toBe(true);
    for (const sample of ['I build developer tools', 'p99 < 2 s', 'US · remote', '© 2026']) {
      expect(BYTE_FIGURE.test(sample), sample).toBe(false);
      expect(BUILD_READOUT.test(sample), sample).toBe(false);
    }
    expect(
      visibleText('<head><meta name="build" content="x"></head><body><p>a <b>b</b></p></body>'),
    ).toBe(' a b ');
  });
});

// No time zone anywhere: a time of day, or an offset other than Z, would tell a reader when or
// where the build ran (content.md, "Home page": no UTC offset anywhere). Midnight UTC carries
// neither, which is how security.txt writes the Expires date RFC 9116 requires. Every common way
// to write a time is read, not only ISO 8601's: RSS and HTTP dates (RFC 2822), ISO's basic form,
// 12-hour clocks, a zone's abbreviation or IANA name, and a PDF's dates.
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const UTC = /^(?:Z|GMT|UTC|UT|[+-]00:?00)$/;
const MIDNIGHT = /^0?0:00(?::00(?:\.0+)?)?$/;
/** Only midnight in UTC passes: anything else is a time of day or a zone. */
const leaks = (time: string, zone: string) => !(MIDNIGHT.test(time) && UTC.test(zone));
// Zone abbreviations, written next to a time ("4:30 CET"); UTC itself is in UTC above.
const ZONES =
  'A[CEKW]?[DS]T|BST|CAT|CE[ST]T?|CST|EA[ST]|EE[ST]T?|E[DS]T|GMT|HK[ST]|HST|I[DS]T|JST|KST|M[DS]T|MSK|NZ[DS]T|P[DS]T|SAST|UTC|UT|WA[ST]|WE[ST]T?|WIB|Z';
const IANA =
  /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc|US|Canada|Mexico|Brazil|Chile)\/[A-Z][A-Za-z_+-]+(?:\/[A-Z][A-Za-z_+-]+)?\b/g;

function leaksTime(text: string): string[] {
  const found: string[] = [];
  // ISO 8601, extended: 2026-10-23T04:30:00+01:00
  for (const [stamp, time = '', zone = ''] of text.matchAll(
    /\b\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?/g,
  )) {
    if (leaks(time, zone)) found.push(stamp);
  }
  // ISO 8601, basic: 20261023T043000+0100
  for (const [stamp, time = '', zone = ''] of text.matchAll(
    /\b\d{8}T(\d{4}(?:\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?\b/g,
  )) {
    if (
      leaks(
        time.replace(
          /^(\d{2})(\d{2})(\d{2})?/,
          (_, h, m, sec) => `${h}:${m}${sec ? `:${sec}` : ''}`,
        ),
        zone,
      )
    )
      found.push(stamp);
  }
  // RFC 2822 and HTTP dates: Fri, 23 Oct 2026 04:30:00 GMT; and month-first: Oct 23, 2026 4:30
  for (const [stamp, time = '', zone = ''] of text.matchAll(
    new RegExp(
      `\\b(?:\\d{1,2}\\s+${MONTH}\\s+\\d{2,4}|${MONTH}\\s+\\d{1,2},?\\s+\\d{4}),?\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)(?:\\s*([+-]\\d{4}|[A-Z]{1,5}\\b))?`,
      'g',
    ),
  )) {
    if (leaks(time, zone)) found.push(stamp);
  }
  // A time with an offset, alone: 04:30:00-06:00
  for (const [stamp] of text.matchAll(/\b\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?[+-]\d{2}:?\d{2}\b/g))
    found.push(stamp);
  // A 12-hour clock: 4:30 PM, 4:30pm, 4:30 p.m.
  for (const [stamp] of text.matchAll(/\b\d{1,2}(?::\d{2}){1,2}\s*[AaPp]\.?[Mm]\b\.?/g))
    found.push(stamp);
  // A time next to a zone's abbreviation: 04:30 CET
  for (const [stamp, time = '', zone = ''] of text.matchAll(
    new RegExp(`\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s*(${ZONES})\\b`, 'g'),
  )) {
    if (leaks(time, zone)) found.push(stamp);
  }
  // An IANA zone name: Europe/Paris, America/Chicago, US/Central
  for (const [stamp] of text.matchAll(IANA)) found.push(stamp);
  // A PDF date: D:20261023043000+01'00'
  for (const [stamp] of text.matchAll(/\bD:\d{8,14}(?:Z|[+-]\d{2}'?\d{2}'?)?/g)) found.push(stamp);
  return [...new Set(found)];
}

test('no file the site serves carries a time of day or a UTC offset', () => {
  expect(
    textFiles.flatMap((file) => leaksTime(read(file)).map((stamp) => `${file}: ${stamp}`)),
  ).toEqual([]);
});

test('known answers for the timestamp check', () => {
  for (const sample of [
    '2026-10-23T04:30',
    '2026-10-23 04:30Z',
    '2026-10-23T00:00:00-06:00',
    '04:30:00-06:00',
    '04:30+0200',
    'Fri, 23 Oct 2026 04:30:00 GMT',
    'Fri, 23 Oct 2026 04:30:00 +0100',
    'Fri, 23 Oct 2026 00:00:00 +0100',
    '23 October 2026 04:30',
    'Oct 23, 2026, 4:30',
    '20261023T043000+0100',
    '20261023T0430Z',
    '4:30 PM CET',
    '4:30pm',
    '16:30 CEST',
    'Europe/Paris',
    'America/Argentina/Buenos_Aires',
    'US/Central',
    'D:20261023043000+0100',
    "D:20261023043000+01'00'",
  ]) {
    expect(leaksTime(sample), sample).not.toEqual([]);
  }
  for (const sample of [
    '2026-10-23',
    '2027-09-30T00:00:00Z',
    'Fri, 23 Oct 2026 00:00:00 GMT',
    '20270930T000000Z',
    'build 8c2067e',
    'v1.2.1',
    'a 16:9 frame',
    'fonts/OFL-InstrumentSans.txt',
    'Version 2.304',
    '© 2026 Joseph Peterson',
  ]) {
    expect(leaksTime(sample), sample).toEqual([]);
  }
});
