import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import {
  cardTree,
  drawnStrings,
  homeCard,
  ogAlt,
  ogSvg,
  ogTree,
  OG_SIZE,
  postCard,
  renderOg,
  SUMMARY,
  summaryLines,
  titleSize,
  wordWidth,
  type OgArt,
  type OgCard,
  type OgNode,
} from '../src/lib/og';
import { clusterBox, homeArt, labIndexArt, OG_GLYPHS } from '../src/lib/og-art';
import { byLabOrder } from '../src/lib/lab';
import { demoArt, OG_LINE } from '../src/lib/og-lines';
import { openingServers } from '../src/lib/orbit';
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

/** The labs this build holds, in the order they're met (lib/lab.ts). */
const labs = files
  .map((file) => /^lab\/([a-z0-9-]+)\/index\.html$/.exec(file)?.[1])
  .filter((slug) => slug !== undefined)
  .sort(byLabOrder);

/** What a page's card carries besides its strings, as its og.png endpoint draws it: Home its
 *  cluster, the Lab index its glyphs, a lab its own picture and colour, any other page nothing. */
async function artFor(file: string): Promise<OgArt> {
  if (file === 'index.html') return homeArt(labs);
  if (file === 'lab/index.html') return labIndexArt(labs);
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
  // And what its summary says, where the card has room for it. A title that ends its own sentence
  // takes no second full stop, and with no summary its byline follows it straight away.
  const by = ogAlt.lastIndexOf(' By ');
  const said = /[.!?]$/.test(ogTitle) ? ogTitle : `${ogTitle}.`;
  if (ogAlt === `${said} By ${ogAlt.slice(by + 4)}` && by >= 0 && said === ogTitle)
    return { title: ogTitle, label: ogAlt.slice(by + 4, -1), byline: true };
  if (ogAlt.startsWith(`${said} `) && by >= 0 && ogAlt.endsWith('.'))
    return {
      title: ogTitle,
      summary: ogAlt.slice(said.length + 1, by),
      label: ogAlt.slice(by + 4, -1),
      byline: true,
    };
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
      'og:title and og:image:alt must be "title · label" and "title, label", or a post\'s "title" and "title, by label" or "title. summary By label."',
    ).not.toBeNull();
    // A lab's card, Home's and the Lab index's also carry a picture, which draws no word
    // (lib/route-lab/og-map.ts, lib/og-lines.ts, lib/og-art.ts).
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

// The page is the water on every map (design-system.md, "Map colors"), and on a card the page is the
// field. Painted in the page's colour, the map stood on the field as a flat panel: the grid stopped
// dead along its straight left edge. The sound runs out across that edge, so a clear water leaves
// nothing there to see.
describe("the Route Lab's card has no edge where its map starts", () => {
  /** How many pixels down a picture's left edge something is drawn. */
  async function drawnDownItsLeftEdge(png: Buffer): Promise<number> {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let drawn = 0;
    for (let y = 0; y < info.height; y += 1)
      if ((data[y * info.width * info.channels + 3] ?? 0) > 0) drawn += 1;
    return drawn;
  }

  test('its water is clear, so the field runs through it, and its land is not', async () => {
    const picture = await demoPicture('routes', app);
    if (!picture) throw new Error('the Route Lab has no picture');
    expect(await drawnDownItsLeftEdge(picture)).toBe(0);
    const { data, info } = await sharp(picture).raw().toBuffer({ resolveWithObject: true });
    const pixels = data.length / info.channels;
    let opaque = 0;
    for (let at = info.channels - 1; at < data.length; at += info.channels)
      if (data[at] === 255) opaque += 1;
    // A map, not a few lines: land and water each take a good part of it.
    expect(opaque / pixels).toBeGreaterThan(0.3);
    expect(opaque / pixels).toBeLessThan(0.8);
  });

  test('known answer: a picture painted to its edge is what this finds', async () => {
    const painted = await sharp({
      create: { width: 4, height: 6, channels: 4, background: { r: 9, g: 12, b: 18, alpha: 1 } },
    })
      .png()
      .toBuffer();
    expect(await drawnDownItsLeftEdge(painted)).toBe(6);
  });
});

test("each lab's card carries its line in its own colour", async () => {
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
  // A lab's colour differs from --primary, so the lamp is not the plain one by chance.
  for (const slug of labs)
    expect(hex(night.get(`line-${slug}`)!)).not.toBe(hex(night.get('primary')!));
});

test('a picture across the top draws no string', () => {
  const colors = { background: '', foreground: '', muted: '', accent: '' };
  for (const box of [OG_LINE, OG_GLYPHS]) {
    const tree = ogTree({ title: 'A', label: 'B' }, colors, { src: 'x', ...box });
    expect(drawnStrings(tree)).toEqual(['A', 'B']);
  }
});

test('known answers: a card is read back from its two strings, whatever they hold', () => {
  expect(cardFrom('A · B', 'A, B')).toEqual({ title: 'A', label: 'B' });
  expect(cardFrom('Why A · B matters · Writing', 'Why A · B matters, Writing')).toEqual({
    title: 'Why A · B matters',
    label: 'Writing',
  });
  expect(cardFrom('A · B', 'A, C')).toBeNull();
  expect(cardFrom('A', 'A, by B')).toEqual({ title: 'A', label: 'B', byline: true });
  expect(cardFrom('A', 'A. It said so. By B.')).toEqual({
    title: 'A',
    summary: 'It said so.',
    label: 'B',
    byline: true,
  });
  // A title that ends its own sentence takes no second full stop, in the alt or its reading back.
  const ended = { title: 'A. C.', label: 'B', byline: true };
  expect(ogAlt({ ...ended, summary: 'It said so.' })).toBe('A. C. It said so. By B.');
  expect(ogAlt(ended)).toBe('A. C. By B.');
  expect(ogAlt({ title: 'A', label: 'B', byline: true })).toBe('A, by B');
  expect(cardFrom('A. C.', 'A. C. It said so. By B.')).toEqual({
    ...ended,
    summary: 'It said so.',
  });
  expect(cardFrom('A. C.', 'A. C. By B.')).toEqual(ended);
});

// A post's card, which carries its summary between its title and its byline, so a share has a hook
// before anyone reads a word of the post. A summary is written for a search result, up to 160
// characters, so it's never cut to fit: one that takes more than two lines stays off the card.
describe("a post's card", () => {
  const colors = { background: '', foreground: '', muted: '', accent: '' };
  const LABEL_SIZE = 44;

  /** The cards of the posts in this build, as their pages say them. */
  const posts = previewed.flatMap((file) => {
    const page = read(file);
    const card = cardFrom(
      decode(meta(page, 'og:title') ?? ''),
      decode(meta(page, 'og:image:alt') ?? ''),
    );
    return card?.byline ? [{ file, page, card }] : [];
  });

  /** How many of a card's pixels stand outside a 3:2 centre crop of it, with no field behind its
   *  words: 127.5 px comes off each side, so these are the pixels wholly past 127.5 and 1072.5. */
  async function outsideTheCrop(card: OgCard): Promise<number> {
    const svg = await ogSvg(cardTree(card));
    const { data, info } = await sharp(Buffer.from(svg))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cut = (OG_SIZE.width - OG_SIZE.height * 1.5) / 2;
    expect(cut).toBe(127.5);
    let outside = 0;
    for (let y = 0; y < info.height; y += 1)
      for (let x = 0; x < info.width; x += 1) {
        if (x + 1 > cut && x < OG_SIZE.width - cut) continue;
        const at = (y * info.width + x) * info.channels;
        const same = [0, 1, 2].every((c) => data[at + c] === data[c]);
        if (!same) outside += 1;
      }
    return outside;
  }

  test('the tree draws the title, then the summary, then the byline', () => {
    const card = { title: 'A', summary: 'S', label: 'B', byline: true };
    expect(drawnStrings(ogTree(card, colors))).toEqual(['A', 'S', 'B']);
    expect(drawnStrings(ogTree({ title: 'A', label: 'B', byline: true }, colors))).toEqual([
      'A',
      'B',
    ]);
  });

  test('known answers: a summary of two lines is on the card, and one of three is left off', () => {
    const post = { title: 'A' };
    const two = 'word '.repeat(15).trim();
    expect(summaryLines(two)).toHaveLength(2);
    expect(postCard({ ...post, summary: two }, 'B').summary).toBe(two);
    const three = 'word '.repeat(25).trim();
    expect(summaryLines(three).length).toBeGreaterThan(2);
    expect(postCard({ ...post, summary: three }, 'B')).toEqual({
      title: 'A',
      label: 'B',
      byline: true,
    });
  });

  // The essay's hook fits. A summary that doesn't takes three lines at any size a 550 px card can
  // read, and isn't cut to fit, so that card has none (the known answers above).
  test.runIf(html.includes('writing/coding-by-hand/index.html'))(
    'the essay’s card says its hook, and its alt says what the card says',
    () => {
      const page = read('writing/coding-by-hand/index.html');
      const hook = 'I doubt anyone in the back seat of a driverless Waymo is checking the mirrors.';
      expect(decode(meta(page, 'og:image:alt') ?? '')).toBe(
        `Coding is fun. That won’t save it. ${hook} By ${profile.basics.name}.`,
      );
      expect(summaryLines(hook)).toEqual([
        'I doubt anyone in the back seat of a',
        'driverless Waymo is checking the mirrors.',
      ]);
    },
  );

  for (const { file, card } of posts) {
    test(`${file}: its title keeps its size, its summary two lines at most, its byline the foot`, async () => {
      const svg = await ogSvg(cardTree(card), false);
      const title = titleRuns(svg, titleSize(card.title));
      // A line can end on a space that hangs past the margin: that's no word past it.
      const problems = wrapProblems(card.title, title, 1072);
      expect(problems.filter((problem) => !problem.startsWith('" "'))).toEqual([]);
      const label = titleRuns(svg, LABEL_SIZE);
      expect(label.length).toBeGreaterThan(0);
      if (!card.summary) return;
      const summary = titleRuns(svg, SUMMARY.size);
      expect(linesOf(summary)).toEqual(summaryLines(card.summary));
      expect(linesOf(summary).length).toBeLessThanOrEqual(SUMMARY.lines);
      // The title stands over it, and the byline under it, with nothing touching: a baseline to the
      // next line's top, with the descent and the ascent of each counted generously.
      const y = (runs: typeof summary) => runs.map((run) => run.y);
      expect(Math.max(...y(title)) + titleSize(card.title) * 0.3).toBeLessThanOrEqual(
        Math.min(...y(summary)) - SUMMARY.size * 0.8,
      );
      expect(Math.max(...y(summary)) + SUMMARY.size * 0.3).toBeLessThanOrEqual(
        Math.min(...y(label)) - LABEL_SIZE * 0.8,
      );
    });

    // 72 + 56 = 128 px is on purpose: the words stay inside what a 3:2 tile shows, so a crop to a
    // square-ish thumbnail doesn't cut a word.
    test(`${file}: every word of its card stays inside a 3:2 centre crop`, async () => {
      expect(await outsideTheCrop(card)).toBe(0);
    });
  }

  test('known answer: a card with no inset is what that check finds', async () => {
    const wide = { title: 'A title long enough to reach both of the margins', label: 'Lab' };
    expect(await outsideTheCrop(wide)).toBeGreaterThan(0);
  });

  test('the longest title a post can have still leaves room for a two-line summary', async () => {
    const title = `${'Backpressure '.repeat(5)}retried`.slice(0, 70);
    const card = postCard({ title, summary: 'word '.repeat(15).trim() }, 'Joseph Peterson');
    expect(card.summary).toBeDefined();
    const svg = await ogSvg(cardTree(card), false);
    const summary = titleRuns(svg, SUMMARY.size);
    const label = titleRuns(svg, LABEL_SIZE);
    expect(Math.max(...summary.map((run) => run.y)) + SUMMARY.size * 0.3).toBeLessThanOrEqual(
      Math.min(...label.map((run) => run.y)) - LABEL_SIZE * 0.8,
    );
  });
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
  // A line may end at a space, or after a hyphen, where any browser would break it too.
  const joined = (text: string) => text.replace(/-\s+/g, '-');
  return [
    ...(joined(lines.join(' ')) === joined(title)
      ? []
      : [`"${title}" wraps as ${JSON.stringify(lines)}`]),
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
    const size = titleSize(card.title);
    const runs = titleRuns(await ogSvg(cardTree(card, art), false), size);
    expect(wrapProblems(card.title, runs, rightEdge(art))).toEqual([]);
    // Under a picture across the top, its lines, the gap, the label and the margin fit what's left.
    const across = art.picture?.readUInt32BE(16) === OG_SIZE.width;
    const above = across ? (art.picture?.readUInt32BE(20) ?? 0) : 0;
    const words = linesOf(runs).length * size * 1.06 + 28 + 44 * 1.2 + 72;
    expect(above + words, 'the words fit under the picture').toBeLessThanOrEqual(OG_SIZE.height);
  });
}

/** How many of a PNG's pixels hold a colour away from the accent: a pixel counts once its strongest
 *  channel is 40 of 255 over its weakest, which the page's near-black, its white and its greys don't
 *  reach, and its hue is more than 20 degrees from the accent's. */
async function offAccent(png: Buffer): Promise<number> {
  const hueOf = (r: number, g: number, b: number) => {
    const [top, chroma] = [Math.max(r, g, b), Math.max(r, g, b) - Math.min(r, g, b)];
    const turn =
      top === r
        ? ((g - b) / chroma + 6) % 6
        : top === g
          ? (b - r) / chroma + 2
          : (r - g) / chroma + 4;
    return turn * 60;
  };
  const accent = /^#(..)(..)(..)$/.exec(hex(themeColors(tokensCss, 'dark').get('primary')!)) ?? [];
  const [r, g, b] = accent.slice(1).map((pair) => Number.parseInt(pair, 16)) as [
    number,
    number,
    number,
  ];
  const wanted = hueOf(r, g, b);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let off = 0;
  for (let at = 0; at < data.length; at += info.channels) {
    const [red, green, blue] = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) < 40) continue;
    const apart = Math.abs(hueOf(red, green, blue) - wanted);
    if (Math.min(apart, 360 - apart) > 20) off += 1;
  }
  return off;
}

describe("Home's card looks like the page it opens (ADR 0029)", () => {
  test("black and white and one accent: no lab's colour on it", async () => {
    expect(await offAccent(bytes('og.png'))).toBe(0);
  });

  test('known answer: a colour off the accent is counted, pixel by pixel', async () => {
    const page = { r: 9, g: 12, b: 18 };
    const blank = sharp({ create: { width: 10, height: 10, channels: 3, background: page } });
    expect(await offAccent(await blank.clone().png().toBuffer())).toBe(0);
    const orange = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 249, g: 124, b: 61 } },
    })
      .png()
      .toBuffer();
    const marked = await blank
      .clone()
      .composite([{ input: orange, left: 0, top: 0 }])
      .png()
      .toBuffer();
    expect(await offAccent(marked)).toBe(6);
  });

  // Where a build has the cluster, the card sets the name as the hero does, and clear of it.
  test.runIf(labs.includes('raft'))(
    'the name stands in two lines, clear of the cluster',
    async () => {
      const card = homeCard(profile);
      const svg = await ogSvg(cardTree(card, await homeArt(labs)), false);
      const runs = titleRuns(svg, titleSize(card.title));
      expect(linesOf(runs)).toEqual(card.title.split(' '));
      const box = clusterBox(openingServers());
      expect(Math.max(...runs.map((run) => run.x + run.width))).toBeLessThan(box.left);
      expect(box.right).toBeLessThan(OG_SIZE.width);
      expect(box.top).toBeGreaterThan(0);
      // The label stands at the card's foot, under the cluster: its line starts below it.
      expect(box.bottom).toBeLessThan(OG_SIZE.height - 72 - 44 * 1.2);
    },
  );
});

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
