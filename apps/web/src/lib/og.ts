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
// picture is also text the build's scans read. A card may also carry a picture with no word in it:
// the Route Lab's map at the card's right edge (lib/route-lab/og-map.ts), or a lab's line, or the
// board's lines stacked, across its top (lib/og-lines.ts). A lab's card lights its lamp in the
// lab's own colour, so a link to it is that lab's before a word is read.

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

/** A picture on a card: a PNG as a data URI, at its own size. One as wide as the card goes above
 *  the words; a narrower one fills the right edge, at the card's full height. */
export interface OgPicture {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** What a card carries besides its two strings: a picture as a PNG, and the lab whose colour,
 *  --line-<slug>, its lamp takes instead of --primary. */
export interface OgArt {
  readonly picture?: Buffer | undefined;
  readonly line?: string | undefined;
}

const node = (style: OgNode['props']['style'], ...children: (OgNode | string)[]): OgNode => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

/** The card as satori's element tree. Colors come in, so the tree holds no literal of its own.
 *  With a picture at the right, the text keeps the left of the card. With one across the top, the
 *  text keeps the rest beneath it: the two are boxes side by side or one over the other, never
 *  layered, so the picture cannot cover a word. */
export function ogTree(
  card: OgCard,
  colors: Record<'background' | 'foreground' | 'muted' | 'accent', string>,
  picture?: OgPicture,
): OgNode {
  const above = picture?.width === OG_SIZE.width;
  const text = node(
    {
      // Satori sizes boxes as content-box: without border-box, the padding would push the card
      // past the canvas and clip its last line.
      width: picture && !above ? OG_SIZE.width - picture.width : '100%',
      height: picture && above ? OG_SIZE.height - picture.height : '100%',
      boxSizing: 'border-box',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      // Under a picture the words need no room above them: the picture's own margin is it.
      padding: above ? '0 72px 72px' : '72px',
      backgroundColor: colors.background,
      color: colors.foreground,
    },
    node(
      { flexDirection: 'column', gap: 28 },
      node(
        {
          fontFamily: 'Archivo Condensed',
          fontWeight: 800,
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
            fontFamily: 'Archivo Expanded',
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
  const img: OgNode = {
    type: 'img',
    props: { src: picture.src, width: picture.width, height: picture.height },
  };
  return above
    ? node(
        {
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          backgroundColor: colors.background,
        },
        img,
        text,
      )
    : node({ width: '100%', height: '100%', backgroundColor: colors.background }, text, img);
}

/** Every string the tree draws, in order. */
export function drawnStrings(tree: OgNode | string): string[] {
  if (typeof tree === 'string') return [tree];
  return (tree.props.children ?? []).flatMap(drawnStrings);
}

// The two faces the card draws, cut by scripts/fonts/build.sh as TrueType, which satori reads:
// Archivo ExtraCondensed for the title, Archivo Expanded for the label (ADR 0027).
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

/** The card as a PNG, with no metadata chunks (scripts/image-metadata.mjs checks it again), with
 *  its picture, a PNG, and its lab's colour on the lamp, when it has them. */
export async function renderOg(card: OgCard, art: OgArt = {}): Promise<Buffer> {
  const { picture, line } = art;
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
      accent: token(line ? `line-${line}` : 'primary'),
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
        name: 'Archivo Condensed',
        data: font('archivo-condensed-extrabold.ttf'),
        weight: 800,
        style: 'normal',
      },
      {
        name: 'Archivo Expanded',
        data: font('archivo-expanded-medium.ttf'),
        weight: 500,
        style: 'normal',
      },
    ],
  });
  return stripPng(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}
