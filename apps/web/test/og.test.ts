import { describe, expect, test } from 'vitest';
import { drawnStrings, homeCard, ogTree, OG_SIZE, renderOg } from '../src/lib/og';
import { bytes, html, profile, read } from './support/dist';

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
    ogTree(card, { background: '', foreground: '', muted: '', border: '', accent: '' }),
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

test('pages without a canonical URL (the 404) carry no preview tags', () => {
  for (const file of html.filter((f) => !read(f).includes('rel="canonical"'))) {
    expect(read(file), file).not.toMatch(/property="og:/);
  }
});
