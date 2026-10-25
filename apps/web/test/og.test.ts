import { describe, expect, test } from 'vitest';
import {
  drawnStrings,
  homeCard,
  ogTree,
  OG_SIZE,
  renderOg,
  titleSize,
  type OgCard,
} from '../src/lib/og';
import { demoPicture } from '../src/lib/route-lab/og-map';
import { app, bytes, fileFor, files, html, profile, read } from './support/dist';

// Link previews (content.md, "Structured data and link previews"). Pixels cannot be scanned for
// held names or firewall terms, so the card draws only two strings, and they must be the page's
// own og:title and og:image:alt, which every text scan reads. And the PNG in dist/ must be exactly
// the card drawn from those strings: the check renders it again and compares the bytes.

function meta(page: string, key: string): string | undefined {
  return new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(page)?.[1];
}

const decode = (text: string) =>
  text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

describe("Home's link preview", () => {
  const page = read('index.html');
  const card = homeCard(profile);
  const drawn = drawnStrings(
    ogTree(card, { background: '', foreground: '', muted: '', accent: '' }),
  );

  test('carries every tag LinkedIn and Slack read, with og:url the canonical URL', () => {
    const canonical = /<link rel="canonical" href="([^"]*)">/.exec(page)?.[1];
    expect(meta(page, 'og:type')).toBe('website');
    expect(meta(page, 'og:url')).toBe(canonical);
    expect(meta(page, 'og:description')).toBe(
      /<meta name="description" content="([^"]*)">/.exec(page)?.[1],
    );
    expect(meta(page, 'og:image')).toBe('https://ihaveasegway.com/og.png');
    expect(meta(page, 'og:image:type')).toBe('image/png');
    expect(meta(page, 'og:image:width')).toBe(String(OG_SIZE.width));
    expect(meta(page, 'og:image:height')).toBe(String(OG_SIZE.height));
    expect(meta(page, 'twitter:card')).toBe('summary_large_image');
  });

  test('the card draws exactly two strings, and they are og:title and og:image:alt', () => {
    expect(drawn).toEqual([card.title, card.label]);
    expect(decode(meta(page, 'og:title') ?? '')).toBe(drawn.join(' · '));
    expect(decode(meta(page, 'og:image:alt') ?? '')).toBe(drawn.join(', '));
  });

  test('dist/og.png is a 1200×630 PNG with only the chunks an image needs', () => {
    const png = bytes('og.png');
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([OG_SIZE.width, OG_SIZE.height]);
    const chunks = new Set<string>();
    for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at))
      chunks.add(png.toString('latin1', at + 4, at + 8));
    expect(
      [...chunks].filter((c) => !['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(c)),
    ).toEqual([]);
  });

  test('dist/og.png is the card drawn from those strings, byte for byte', async () => {
    expect((await renderOg(card)).equals(bytes('og.png'))).toBe(true);
  });
});

/** The two strings a card drew, read back from og:title ("title · label") and og:image:alt
 *  ("title, label"): the one split where both agree. */
function cardFrom(ogTitle: string, ogAlt: string): OgCard | null {
  for (let at = ogTitle.indexOf(' · '); at >= 0; at = ogTitle.indexOf(' · ', at + 1)) {
    const card = { title: ogTitle.slice(0, at), label: ogTitle.slice(at + 3) };
    if (ogAlt === `${card.title}, ${card.label}`) return card;
  }
  return null;
}

// Every page with a preview, not only Home: posts and their indexes draw their own cards. Each
// card is redrawn from the page's own og:title and og:image:alt and compared byte for byte, so no
// picture holds a word the page's text does not.
const previewed = html.filter((file) => meta(read(file), 'og:image') !== undefined);
for (const file of previewed) {
  test(`${file}: its og:image is a 1200×630 PNG beside it, drawn from its own text`, async () => {
    const page = read(file);
    const image = meta(page, 'og:image') ?? '';
    expect(image).toBe(new URL('og.png', meta(page, 'og:url')).href);
    const png = fileFor(image);
    expect(files).toContain(png);
    const card = cardFrom(
      decode(meta(page, 'og:title') ?? ''),
      decode(meta(page, 'og:image:alt') ?? ''),
    );
    expect(
      card,
      'og:title and og:image:alt must be "title · label" and "title, label"',
    ).not.toBeNull();
    // A demo's card also carries its picture, which draws no word (lib/route-lab/og-map.ts).
    const demo = /^lab\/([a-z0-9-]+)\/index\.html$/.exec(file)?.[1];
    const picture = demo ? await demoPicture(demo, app) : undefined;
    expect((await renderOg(card as OgCard, picture)).equals(bytes(png))).toBe(true);
    expect(meta(page, 'og:type')).toBe(
      /^(writing|notes)\/[a-z0-9-]+\//.test(file) ? 'article' : 'website',
    );
  });
}

test("the Route Lab's card carries its map, which draws no string, at the card's full height", async () => {
  const picture = await demoPicture('routes', app);
  if (!picture) throw new Error('the Route Lab has no picture');
  expect([picture.readUInt32BE(16), picture.readUInt32BE(20)]).toEqual([491, OG_SIZE.height]);
  const colors = { background: '', foreground: '', muted: '', accent: '' };
  const tree = ogTree({ title: 'A', label: 'B' }, colors, { src: 'x', width: 491, height: 630 });
  expect(drawnStrings(tree)).toEqual(['A', 'B']);
  expect(demoPicture('another', app)).toBeUndefined();
});

test('known answers: a card is read back from its two strings, whatever they hold', () => {
  expect(cardFrom('A · B', 'A, B')).toEqual({ title: 'A', label: 'B' });
  expect(cardFrom('Why A · B matters · Writing', 'Why A · B matters, Writing')).toEqual({
    title: 'Why A · B matters',
    label: 'Writing',
  });
  expect(cardFrom('A · B', 'A, C')).toBeNull();
});

test("a title's size steps down with its length, so the longest title still fits the card", () => {
  expect(titleSize(homeCard(profile).title)).toBe(150);
  expect(titleSize('x'.repeat(16))).toBe(150);
  expect(titleSize('x'.repeat(17))).toBe(104);
  expect(titleSize('x'.repeat(32))).toBe(104);
  expect(titleSize('x'.repeat(33))).toBe(80);
  expect(titleSize('x'.repeat(70))).toBe(80);
});

test('pages without a canonical URL (the 404) carry no preview tags', () => {
  for (const file of html.filter((f) => !read(f).includes('rel="canonical"'))) {
    expect(read(file), file).not.toMatch(/property="og:/);
  }
});
