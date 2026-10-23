import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { kilobytes } from '../src/lib/weights';
import { read, textFiles } from './support/dist';
import { measure } from './support/measure';

// Every figure Home prints is computed at build, and this test measures dist/ again and requires
// the two to agree (spec B13): a readout that drifts from what it describes fails the build.

const home = read('index.html');
const figures = measure(home);

/** The <dd> after the <dt> that reads `term`, in either list on the page. */
function readout(term: string): string {
  const match = new RegExp(`<dt[^>]*>${term}</dt>\\s*<dd>(.*?)</dd>`).exec(home);
  if (!match?.[1]) throw new Error(`Home has no "${term}" readout`);
  return match[1].replace(/<[^>]+>/g, '');
}
/** Every <dd> after a <dt> that reads `term`. */
const all = (term: string) =>
  [...home.matchAll(new RegExp(`<dt[^>]*>${term}</dt>\\s*<dd>(.*?)</dd>`, 'g'))].map(
    ([, value = '']) => value.replace(/<[^>]+>/g, ''),
  );

describe("Home's readouts", () => {
  test('Build is the commit this checkout builds, read here from git, not from build.ts', () => {
    const commit = (
      process.env['GITHUB_SHA'] ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
    ).trim();
    expect(readout('Build')).toBe(commit.slice(0, 7));
  });

  test('Built is a UTC date with no time of day, and not in the future', () => {
    const built = readout('Built');
    expect(built).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(home).toContain(`<time datetime="${built}">${built}</time>`);
    expect(Date.parse(`${built}T00:00:00Z`)).toBeLessThanOrEqual(Date.now());
  });

  test(`JavaScript is the page's eager JavaScript, measured: ${figures.eagerJavaScript} B`, () => {
    expect(all('JavaScript')).toEqual([
      kilobytes(figures.eagerJavaScript),
      `${kilobytes(figures.eagerJavaScript)} on this page`,
    ]);
  });

  test(`Fonts on the This site card is the preloaded fonts, measured: ${figures.preloadedFonts} B`, () => {
    expect(readout('Fonts')).toBe(`${kilobytes(figures.preloadedFonts)}, self-hosted`);
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
