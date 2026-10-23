import satori from 'satori';
import sharp from 'sharp';
import tokensCss from '../styles/tokens.css?raw';
import type { Profile } from './profile';
import { hex, themeColors } from './tokens';

// Open Graph images (content.md, "Structured data and link previews"): 1200×630 PNGs drawn at
// build time from a page's title and label, in the site's tokens. Satori lays the card out and
// turns its text into paths; sharp rasterizes that SVG. Nothing else is drawn: the card takes
// exactly two strings, and test/og.test.ts checks that they are the page's og:title and
// og:image:alt, so every word in the picture is also text the build's scans read.

export interface OgCard {
  readonly title: string;
  readonly label: string;
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** The card for Home: the name and the title line. */
export function homeCard(profile: Profile): OgCard {
  return { title: profile.basics.name, label: profile.basics.label };
}

/** og:title and og:image:alt, written from the drawn strings and nothing else. */
export const ogTitle = (card: OgCard) => `${card.title} · ${card.label}`;
export const ogAlt = (card: OgCard) => `${card.title}, ${card.label}`;

export interface OgNode {
  type: string;
  props: { style?: Record<string, string | number>; children?: (OgNode | string)[] };
}

const node = (style: OgNode['props']['style'], ...children: (OgNode | string)[]): OgNode => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

/** The card as satori's element tree. Colors come in, so the tree holds no literal of its own. */
export function ogTree(
  card: OgCard,
  colors: Record<'background' | 'foreground' | 'muted' | 'border' | 'accent', string>,
): OgNode {
  const tick = () => node({ flex: 1, height: 18, borderLeft: `1px solid ${colors.border}` });
  return node(
    {
      // Satori sizes boxes as content-box: without border-box, the padding would push the card
      // past the canvas and clip its last line.
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '56px 72px 72px',
      backgroundColor: colors.background,
      color: colors.foreground,
    },
    // The ruler: twelve columns, as on every page. Decoration only.
    node(
      {
        width: '100%',
        borderRight: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
      },
      ...Array.from({ length: 12 }, tick),
    ),
    node(
      { flexDirection: 'column', gap: 28 },
      node(
        {
          fontFamily: 'Instrument Sans Condensed',
          fontWeight: 600,
          fontSize: 150,
          lineHeight: 0.9,
          letterSpacing: -5.25,
        },
        card.title,
      ),
      node(
        { alignItems: 'center', gap: 18 },
        node({ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent }),
        node(
          { fontFamily: 'Instrument Sans', fontWeight: 500, fontSize: 44, color: colors.muted },
          card.label,
        ),
      ),
    ),
  );
}

/** Every string the tree draws, in order. */
export function drawnStrings(tree: OgNode | string): string[] {
  if (typeof tree === 'string') return [tree];
  return (tree.props.children ?? []).flatMap(drawnStrings);
}

// Static instances cut by scripts/fonts/build.sh: satori draws a variable font at its default
// instance and ignores font-stretch, so the condensed name has a file of its own.
const fontFiles = import.meta.glob<string>('../og/fonts/*.ttf', {
  query: '?inline',
  import: 'default',
  eager: true,
});

function font(file: string): Buffer {
  const entry = Object.entries(fontFiles).find(([path]) => path.endsWith(`/${file}`));
  if (!entry) throw new Error(`og.ts: src/og/fonts/${file} is missing; run scripts/fonts/build.sh`);
  return Buffer.from(entry[1].slice(entry[1].indexOf(',') + 1), 'base64');
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/** Keeps only the chunks a PNG needs to render, as scripts/icons.mjs does for the icons: no text,
 *  no timestamp, not even sharp's pixel density. */
export function stripPng(png: Buffer): Buffer {
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (PNG_KEEP.has(png.toString('latin1', at + 4, at + 8)))
      parts.push(png.subarray(at, at + 12 + length));
    at += 12 + length;
  }
  return Buffer.concat(parts);
}

/** The card as a PNG, with no metadata chunks (scripts/image-metadata.mjs checks it again). */
export async function renderOg(card: OgCard): Promise<Buffer> {
  const colors = themeColors(tokensCss, 'dark');
  const token = (name: string) => {
    const value = colors.get(name);
    if (!value) throw new Error(`og.ts: tokens.css has no --${name}`);
    return hex(value);
  };
  const tree = ogTree(card, {
    background: token('background'),
    foreground: token('foreground'),
    muted: token('muted-foreground'),
    border: token('border'),
    accent: token('primary'),
  });
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    ...OG_SIZE,
    fonts: [
      {
        name: 'Instrument Sans Condensed',
        data: font('instrument-sans-80-620.ttf'),
        weight: 600,
        style: 'normal',
      },
      {
        name: 'Instrument Sans',
        data: font('instrument-sans-100-550.ttf'),
        weight: 500,
        style: 'normal',
      },
    ],
  });
  return stripPng(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}
