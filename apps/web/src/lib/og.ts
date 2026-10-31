import satori from 'satori';
import sharp from 'sharp';
import tokensCss from '../styles/tokens.css?raw';
import type { LabEntry } from './lab';
import { SECTION_LABELS, type Post, type Section } from './posts';
import type { Profile } from './profile';
import { hex, themeColors } from './tokens';

// Open Graph images (content.md, "Structured data and link previews"): 1200×630 PNGs drawn at
// build time from a page's title and label, in the site's tokens. Satori lays the card out and
// turns its text into paths; sharp rasterizes that SVG. The card takes exactly two strings, and
// test/og.test.ts checks that they are the page's og:title and og:image:alt, so every word in the
// picture is also text the build's scans read. A demo's card may also carry a picture of the demo
// with no word in it (lib/route-lab/og-map.ts), at the card's right edge.

export interface OgCard {
  readonly title: string;
  readonly label: string;
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** The card for Home: the name and the title line. */
export function homeCard(profile: Profile): OgCard {
  return { title: profile.basics.name, label: profile.basics.label };
}

/** About's card: the name, and the page's own label, as the header names it. It holds the résumé,
 *  whose card this was (2026-10-28). */
export function aboutCard(profile: Profile, label: string): OgCard {
  return { title: profile.basics.name, label };
}

/** A post's card: its title, and the section it belongs to (content.md, "Structured data and
 *  link previews": the section label and the entry's title). */
export function postCard(post: Pick<Post, 'title' | 'section'>): OgCard {
  return { title: post.title, label: SECTION_LABELS[post.section] };
}

/** A section index's card: the section, and whose it is. */
export function sectionCard(section: Section, profile: Profile): OgCard {
  return { title: SECTION_LABELS[section], label: profile.basics.name };
}

/** A demo's card: its title, and the section, Lab. */
export function labCard(entry: Pick<LabEntry, 'title'>): OgCard {
  return { title: entry.title, label: 'Lab' };
}

/** The lab index's card: the section, and whose it is. */
export function labIndexCard(profile: Profile): OgCard {
  return { title: 'Lab', label: profile.basics.name };
}

/**
 * The title's size on the card. Home's name is drawn at 150 px; a post's title can run to 70
 * characters (lib/posts.ts), which at that size would need five lines and leave the canvas. So the
 * size steps down with the length, and the longest title fits in three lines at 80 px. Steps rather
 * than a formula, so a title one character longer than another never draws at an odd size.
 */
export function titleSize(title: string): number {
  if (title.length <= 16) return 150;
  if (title.length <= 32) return 104;
  return 80;
}

/** og:title and og:image:alt, written from the drawn strings and nothing else. */
export const ogTitle = (card: OgCard) => `${card.title} · ${card.label}`;
export const ogAlt = (card: OgCard) => `${card.title}, ${card.label}`;

export interface OgNode {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: (OgNode | string)[];
    src?: string;
    width?: number;
    height?: number;
  };
}

/** A picture on a card: a PNG as a data URI, at its own size. */
export interface OgPicture {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

const node = (style: OgNode['props']['style'], ...children: (OgNode | string)[]): OgNode => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

/** The card as satori's element tree. Colors come in, so the tree holds no literal of its own.
 *  With a picture, the text keeps the left of the card and the picture fills the right edge. */
export function ogTree(
  card: OgCard,
  colors: Record<'background' | 'foreground' | 'muted' | 'accent', string>,
  picture?: OgPicture,
): OgNode {
  const text = node(
    {
      // Satori sizes boxes as content-box: without border-box, the padding would push the card
      // past the canvas and clip its last line.
      width: picture ? OG_SIZE.width - picture.width : '100%',
      height: '100%',
      boxSizing: 'border-box',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: '72px',
      backgroundColor: colors.background,
      color: colors.foreground,
    },
    node(
      { flexDirection: 'column', gap: 28 },
      node(
        {
          fontFamily: 'Barlow Condensed',
          fontWeight: 600,
          fontSize: titleSize(card.title),
          lineHeight: 0.95,
          letterSpacing: titleSize(card.title) * -0.012,
          // A word longer than a line, such as a long identifier, breaks instead of leaving the card.
          wordBreak: 'break-word',
        },
        card.title,
      ),
      node(
        { alignItems: 'center', gap: 18 },
        // A lit lamp, the one round thing the design draws (design-system.md, "Colour").
        node({ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent }),
        node(
          {
            fontFamily: 'Barlow Semi Condensed',
            fontWeight: 500,
            fontSize: 44,
            color: colors.muted,
          },
          card.label,
        ),
      ),
    ),
  );
  if (!picture) return text;
  return node({ width: '100%', height: '100%', backgroundColor: colors.background }, text, {
    type: 'img',
    props: { src: picture.src, width: picture.width, height: picture.height },
  });
}

/** Every string the tree draws, in order. */
export function drawnStrings(tree: OgNode | string): string[] {
  if (typeof tree === 'string') return [tree];
  return (tree.props.children ?? []).flatMap(drawnStrings);
}

// The two faces the card draws, cut by scripts/fonts/build.sh as TrueType, which satori reads:
// Barlow Condensed for the title, Barlow Semi Condensed for the label.
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

/** The card as a PNG, with no metadata chunks (scripts/image-metadata.mjs checks it again). A
 *  picture, a PNG, sits at the card's right edge. */
export async function renderOg(card: OgCard, picture?: Buffer): Promise<Buffer> {
  const colors = themeColors(tokensCss, 'dark');
  const token = (name: string) => {
    const value = colors.get(name);
    if (!value) throw new Error(`og.ts: tokens.css has no --${name}`);
    return hex(value);
  };
  const tree = ogTree(
    card,
    {
      background: token('background'),
      foreground: token('foreground'),
      muted: token('muted-foreground'),
      accent: token('primary'),
    },
    picture && {
      src: `data:image/png;base64,${picture.toString('base64')}`,
      width: picture.readUInt32BE(16),
      height: picture.readUInt32BE(20),
    },
  );
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    ...OG_SIZE,
    fonts: [
      {
        name: 'Barlow Condensed',
        data: font('barlow-condensed-semibold.ttf'),
        weight: 600,
        style: 'normal',
      },
      {
        name: 'Barlow Semi Condensed',
        data: font('barlow-semi-condensed-medium.ttf'),
        weight: 500,
        style: 'normal',
      },
    ],
  });
  return stripPng(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}
