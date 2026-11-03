import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import {
  cardTree,
  drawnStrings,
  homeCard,
  ogSvg,
  ogTree,
  OG_SIZE,
  renderOg,
  titleSize,
  wordWidth,
  type OgArt,
  type OgCard,
  type OgNode,
} from '../src/lib/og';
import { boardArt, demoArt, OG_BOARD, OG_LINE } from '../src/lib/og-lines';
import { demoPicture } from '../src/lib/route-lab/og-map';
import tokensCss from '../src/styles/tokens.css?raw';
import { hex, themeColors } from '../src/lib/tokens';
import { app, bytes, fileFor, files, html, profile, read } from './support/dist';

// Link previews (content.md, "Structured data and link previews"). Pixels cannot be scanned for
// held names or firewall terms, so the card draws only two strings, and they must be the page's
// own og:title and og:image:alt, which every text scan reads. And the PNG in dist/ must be exactly
// the card drawn from those strings: the check renders it again and compares the bytes.

function meta(page: string, key: string): string | undefined {
  return new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(page)?.[1];
}

/** The labs this build holds, in the board's order (lib/lab.ts sorts them by slug). */
const labs = files
  .map((file) => /^lab\/([a-z0-9-]+)\/index\.html$/.exec(file)?.[1])
  .filter((slug) => slug !== undefined)
  .sort((a, b) => a.localeCompare(b));

/** What a page's card carries besides its strings, as its og.png endpoint draws it: Home and the
 *  Lab index carry the board, a demo its own picture and colour, any other page nothing. */
async function artFor(file: string): Promise<OgArt> {
  if (file === 'index.html' || file === 'lab/index.html') return boardArt(labs, app);
  const demo = /^lab\/([a-z0-9-]+)\/index\.html$/.exec(file)?.[1];
  return demo ? demoArt(demo, app) : {};
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
    expect((await renderOg(card, await artFor('index.html'))).equals(bytes('og.png'))).toBe(true);
  });
});

/** The two strings a card drew, read back from og:title ("title · label") and og:image:alt
 *  ("title, label"): the one split where both agree. */
function cardFrom(ogTitle: string, ogAlt: string): OgCard | null {
  // A post's card (ADR 0029): og:title is the title alone, and the alt says who wrote it.
  if (ogAlt.startsWith(`${ogTitle}, by `))
    return { title: ogTitle, label: ogAlt.slice(ogTitle.length + 5), byline: true };
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
      'og:title and og:image:alt must be "title · label" and "title, label", or a post\'s "title" and "title, by label"',
    ).not.toBeNull();
    // A demo's card, Home's and the Lab index's also carry a picture, which draws no word
    // (lib/route-lab/og-map.ts, lib/og-lines.ts).
    expect((await renderOg(card as OgCard, await artFor(file))).equals(bytes(png))).toBe(true);
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

test("each lab's card carries its line in its own colour, and Home's every line", async () => {
  const night = themeColors(tokensCss, 'dark');
  for (const slug of labs) {
    const art = await demoArt(slug, app);
    // Every lab has its colour (tokens.css, --line-<slug>), and its lamp takes it.
    expect(art.line, slug).toBe(slug);
    expect(night.get(`line-${slug}`), slug).toBeDefined();
    const picture = art.picture;
    if (!picture) throw new Error(`${slug}'s card has no picture`);
    // The Route Lab's map stands at the right; every other lab's line spans the card's top.
    const width = picture.readUInt32BE(16);
    if (slug !== 'routes') expect(width, slug).toBe(OG_LINE.width);
  }
  const board = (await boardArt(labs, app)).picture;
  if (labs.length === 0) expect(board).toBeUndefined();
  else
    expect([board?.readUInt32BE(16), board?.readUInt32BE(20)]).toEqual([
      OG_BOARD.width,
      OG_BOARD.height,
    ]);
  // A lab's colour differs from --primary, so the lamp is not the plain one by chance.
  for (const slug of labs)
    expect(hex(night.get(`line-${slug}`)!)).not.toBe(hex(night.get('primary')!));
});

test('a picture across the top leaves the words their room, and draws no string', () => {
  const colors = { background: '', foreground: '', muted: '', accent: '' };
  for (const box of [OG_LINE, OG_BOARD]) {
    const tree = ogTree({ title: 'A', label: 'B' }, colors, { src: 'x', ...box });
    expect(drawnStrings(tree)).toEqual(['A', 'B']);
  }
  // Under a line, the longest title a card draws: three lines at 80 px, the label at 44 px, the
  // gap between them and the bottom padding (lib/og.ts).
  expect(OG_LINE.height + 3 * 80 * 0.95 + 28 + 44 * 1.2 + 72).toBeLessThanOrEqual(OG_SIZE.height);
  // Under the board, Home's name and the Lab index's title, one line at 150 px.
  expect(OG_BOARD.height + 150 * 0.95 + 28 + 44 * 1.2 + 72).toBeLessThanOrEqual(OG_SIZE.height);
});

test('known answers: a card is read back from its two strings, whatever they hold', () => {
  expect(cardFrom('A · B', 'A, B')).toEqual({ title: 'A', label: 'B' });
  expect(cardFrom('Why A · B matters · Writing', 'Why A · B matters, Writing')).toEqual({
    title: 'Why A · B matters',
    label: 'Writing',
  });
  expect(cardFrom('A · B', 'A, C')).toBeNull();
  expect(cardFrom('A', 'A, by B')).toEqual({ title: 'A', label: 'B', byline: true });
});

test("a title's size steps down with its length, so the longest title still fits the card", () => {
  expect(titleSize(homeCard(profile).title)).toBe(100);
  expect(titleSize('x'.repeat(16))).toBe(100);
  expect(titleSize('x'.repeat(17))).toBe(84);
  expect(titleSize('x'.repeat(40))).toBe(84);
  expect(titleSize('x'.repeat(41))).toBe(72);
  expect(titleSize('x'.repeat(70))).toBe(72);
});

// A title wraps only between its words (Cache Lab's card read "Stamped / e a cache" on 2026-11-02).
// Satori with embedFont false leaves its text as <text> runs, each with its place and width, so the
// lines it chose can be read back. Pixels could not be scanned for this, and a byte comparison with
// a redraw says nothing about what the redraw looks like.
interface TitleRun {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly text: string;
}

/** The runs of a card's SVG drawn at the title's size: the label's size is another, 44 px. */
function titleRuns(svg: string, size: number): TitleRun[] {
  return [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].flatMap(
    ([, attributes = '', text = '']) => {
      const read = (name: string) =>
        Number(new RegExp(`\\b${name}="([\\d.]+)"`).exec(attributes)?.[1] ?? NaN);
      return read('font-size') === size
        ? [{ x: read('x'), y: read('y'), width: read('width'), text: decode(text) }]
        : [];
    },
  );
}

/** The lines those runs make, top to bottom, each run left to right. */
function linesOf(runs: readonly TitleRun[]): string[] {
  const rows = [...new Set(runs.map((run) => run.y))].sort((a, b) => a - b);
  return rows.map((y) =>
    runs
      .filter((run) => run.y === y)
      .sort((a, b) => a.x - b.x)
      .map((run) => run.text)
      .join('')
      .trim(),
  );
}

/** What's wrong with how a title was wrapped: a word cut across lines, or a run past the card's
 *  margin. */
function wrapProblems(title: string, runs: readonly TitleRun[], end: number): string[] {
  const lines = linesOf(runs);
  const whole = lines.flatMap((line) => line.split(/\s+/));
  return [
    ...(whole.join(' ') === title ? [] : [`"${title}" wraps as ${JSON.stringify(lines)}`]),
    ...runs
      .filter((run) => run.x + run.width > end + 0.5)
      .map((run) => `"${run.text}" runs past x = ${end}`),
  ];
}

/** Where a card's title has to stop: its right margin, or the map's edge less that margin. */
const rightEdge = (art: OgArt) => {
  const width = art.picture?.readUInt32BE(16);
  return (
    (width === undefined || width === OG_SIZE.width ? OG_SIZE.width : OG_SIZE.width - width) - 72
  );
};

for (const file of previewed) {
  test(`${file}: its card's title wraps only between its words`, async () => {
    const page = read(file);
    const card = cardFrom(
      decode(meta(page, 'og:title') ?? ''),
      decode(meta(page, 'og:image:alt') ?? ''),
    ) as OgCard;
    const art = await artFor(file);
    const runs = titleRuns(await ogSvg(cardTree(card, art), false), titleSize(card.title));
    expect(wrapProblems(card.title, runs, rightEdge(art))).toEqual([]);
  });
}

describe('known answers: a title wraps between its words, whatever its size', () => {
  const line = { width: OG_LINE.width, height: OG_LINE.height };
  const stripe = sharp({
    create: { ...line, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  /** The lines a title draws in, with no picture or with one across the top. */
  async function drawn(title: string, picture?: Buffer) {
    const art = { picture };
    const size = titleSize(title);
    const runs = titleRuns(await ogSvg(cardTree({ title, label: 'Lab' }, art), false), size);
    return { lines: linesOf(runs), problems: wrapProblems(title, runs, rightEdge(art)) };
  }

  // Exactly 16 characters and over a line at 100 px, so it wraps, and "Stampede" is over half a line.
  test('the title that broke, under its line', async () => {
    expect(await drawn('Stampede a cache', await stripe)).toEqual({
      lines: ['Stampede', 'a cache'],
      problems: [],
    });
  });

  // The verifier's list on 2026-11-02: each broke at its own size under a rule of title length.
  for (const title of [
    'Swamped workers',
    'Momentum waves',
    'Backpressure and retries',
    'Implementation details',
    'Misconfiguration at scale',
  ])
    test(title, async () => expect((await drawn(title)).problems).toEqual([]));

  // A word wider than the line still has to stay on the card: this one breaks.
  test('a word wider than the line breaks, and stays on the card', async () => {
    const title = 'a_long_identifier_that_is_much_wider_than_any_line_of_the_card';
    expect(wordWidth(title, titleSize(title))).toBeGreaterThan(1056);
    const { lines, problems } = await drawn(title);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(title);
    expect(problems.filter((problem) => problem.includes('runs past'))).toEqual([]);
  });

  // The measure is the title's own column. This word fits a card with nothing beside it, and is
  // wider than the column the Route Lab's map leaves.
  test('a word that fits the card can still be wider than the column a map leaves it', async () => {
    const title = 'Internationalization';
    const size = titleSize(title);
    const width = wordWidth(title, size);
    expect(width).toBeLessThan(1056);
    expect(width).toBeGreaterThan(OG_SIZE.width - 491 - 144);
    const colors = { background: '', foreground: '', muted: '', accent: '' };
    const style = (tree: OgNode) => JSON.stringify(tree);
    expect(style(ogTree({ title, label: 'B' }, colors))).not.toContain('break-word');
    expect(
      style(ogTree({ title, label: 'B' }, colors, { src: 'x', width: 491, height: 630 })),
    ).toContain('break-word');
  });

  // The checker catches the fault it is here for: the same tree with breaking left on, as it was.
  test('with breaking always on, the cut word is what the check finds', async () => {
    const title = 'Stampede a cache';
    const tree = cardTree({ title, label: 'Lab' }, { picture: await stripe });
    const withBreaking = JSON.parse(
      JSON.stringify(tree).replace(
        '"textWrap":"balance"',
        '"textWrap":"balance","wordBreak":"break-word"',
      ),
    ) as OgNode;
    const runs = titleRuns(await ogSvg(withBreaking, false), titleSize(title));
    expect(linesOf(runs)).toEqual(['Stamped', 'e a cache']);
    expect(wrapProblems(title, runs, 1128)).toEqual([
      '"Stampede a cache" wraps as ["Stamped","e a cache"]',
    ]);
  });

  test('a run past the margin is reported too', () => {
    const run = { x: 1000, y: 10, width: 200, text: 'Long' };
    expect(wrapProblems('Long', [run], 1128)).toEqual(['"Long" runs past x = 1128']);
  });
});

test('pages without a canonical URL (the 404) carry no preview tags', () => {
  for (const file of html.filter((f) => !read(f).includes('rel="canonical"'))) {
    expect(read(file), file).not.toMatch(/property="og:/);
  }
});
