import { create } from 'fontkitten';
import satori from 'satori';
import sharp from 'sharp';
import tokensCss from '../styles/tokens.css?raw';
import type { LabEntry } from './lab';
import { fieldPicture, OG_SIZE } from './og-field';
import { SECTION_LABELS, type Post, type Section } from './posts';
import type { Profile } from './profile';
import { hex, themeColors } from './tokens';

// Open Graph images (content.md, "Structured data and link previews"): 1200×630 PNGs drawn at
// build time from a page's title and label, in the site's tokens. Satori lays the card out and
// turns its text into paths; sharp rasterizes that SVG. The card takes exactly two strings, and
// test/og.test.ts checks that they are the page's og:title and og:image:alt, so every word in the
// picture is also text the build's scans read. Every card stands on the field behind every page
// (lib/og-field.ts). It may also carry a picture with no word in it: the Route Lab's map at the
// card's right edge (lib/route-lab/og-map.ts), a lab's line across its top (lib/og-lines.ts), or
// what its page opens on, Home's cluster or the Lab index's glyphs (lib/og-art.ts). A lab's card
// lights its lamp in the lab's own colour, so a link to it is that lab's before a word is read.

export interface OgCard {
  readonly title: string;
  readonly label: string;
  /** A byline, not a section: og:title is the title alone, and the alt says who wrote it. */
  readonly byline?: boolean;
}

export { OG_SIZE };

/** The card for Home: the name and the title line. */
export function homeCard(profile: Profile): OgCard {
  return { title: profile.basics.name, label: profile.basics.label };
}

/** About's card: the name, and the page's own label, as the header names it. It holds the résumé,
 *  whose card this was (2026-10-28). */
export function aboutCard(profile: Profile, label: string): OgCard {
  return { title: profile.basics.name, label };
}

/** A post's card: its title and who wrote it (ADR 0029). A share arrives cold, on LinkedIn as a
 *  small tile, so the card says what this is and whose it is. */
export function postCard(post: Pick<Post, 'title'>, author: string): OgCard {
  return { title: post.title, label: author, byline: true };
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
 * The title's size on the card. The display face is wide: "Joseph Peterson" is about 10.2em, so at
 * 100 px it just fills the card's measure, and a post's title can run to 70 characters
 * (lib/posts.ts). So the size steps down with the length, and the longest title fits in four lines
 * at 72 px. Steps rather than a formula, so a title one character longer than another never draws at
 * an odd size.
 */
export function titleSize(title: string): number {
  if (title.length <= 16) return 100;
  if (title.length <= 40) return 84;
  return 72;
}

/** The title's tracking at a size, in px. */
const letterSpacing = (size: number) => size * -0.012;

/** og:title and og:image:alt, written from the drawn strings and nothing else. */
export const ogTitle = (card: OgCard) =>
  card.byline ? card.title : `${card.title} · ${card.label}`; // an ogTitle, for the head
export const ogAlt = (card: OgCard) =>
  card.byline ? `${card.title}, by ${card.label}` : `${card.title}, ${card.label}`;

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

/** What a card carries besides its two strings: a picture as a PNG; what stands behind its words in
 *  place of the plain field, a PNG the size of the card; how wide its title may run where that holds
 *  something at the right; and the lab whose colour, --line-<slug>, its lamp takes instead of
 *  --primary. */
export interface OgArt {
  readonly picture?: Buffer | undefined;
  readonly behind?: Buffer | undefined;
  readonly titleColumn?: number | undefined;
  readonly line?: string | undefined;
}

/** What stands behind a card's words, as a data URI, and the title's column it leaves. */
export interface OgStage {
  readonly behind?: string | undefined;
  readonly titleColumn?: number | undefined;
}

const node = (style: OgNode['props']['style'], ...children: (OgNode | string)[]): OgNode => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

/** The width a word of the title takes at a size, in px, with the tree's tracking, read from the
 *  face the card draws it in. Satori measures it the same way. */
export function wordWidth(word: string, size: number): number {
  const face = titleFace();
  const advance = face.glyphsForString(word).reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
  return (advance / face.unitsPerEm) * size + word.length * letterSpacing(size);
}

/** The card as satori's element tree. Colors come in, so the tree holds no literal of its own.
 *  With a picture at the right, the text keeps the left of the card. With one across the top, the
 *  text keeps the rest beneath it: the two are boxes side by side or one over the other, never
 *  layered, so the picture cannot cover a word. What stands behind the words is drawn before them,
 *  and the title's column keeps them clear of what it holds. */
export function ogTree(
  card: OgCard,
  colors: Record<'background' | 'foreground' | 'muted' | 'accent', string>,
  picture?: OgPicture,
  stage: OgStage = {},
): OgNode {
  const above = picture?.width === OG_SIZE.width;
  const size = titleSize(card.title);
  // What the title has across: its box, less the padding and a post's inset below.
  const room =
    stage.titleColumn ??
    (picture && !above ? OG_SIZE.width - picture.width : OG_SIZE.width) -
      2 * 72 -
      (!picture && card.byline ? 2 * 56 : 0);
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
      color: colors.foreground,
    },
    node(
      {
        flexDirection: 'column',
        // With no picture the title takes the top of the card and the label its foot, so the card
        // still reads as a small tile; a post's words also keep clear of a 3:2 centre crop.
        ...(picture
          ? { gap: 28 }
          : {
              height: '100%',
              justifyContent: 'space-between',
              ...(card.byline ? { paddingInline: 56 } : {}),
            }),
      },
      node(
        {
          fontFamily: 'Archivo Display',
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1.06,
          letterSpacing: letterSpacing(size),
          textWrap: 'balance',
          ...(stage.titleColumn ? { maxWidth: stage.titleColumn } : {}),
          // A word wider than the line, such as a long identifier, breaks instead of leaving the
          // card. Only then: balancing narrows the box until the line count would rise, and with
          // breaking on, a cut word keeps the count, so it cut one that fit: "Stamped / e a cache".
          ...(card.title.split(/\s+/).some((word) => wordWidth(word, size) > room)
            ? { wordBreak: 'break-word' }
            : {}),
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
  const img: OgNode | undefined = picture && {
    type: 'img',
    props: { src: picture.src, width: picture.width, height: picture.height },
  };
  const full = { width: '100%', height: '100%' };
  const body = !img
    ? text
    : above
      ? node({ ...full, flexDirection: 'column' }, img, text)
      : node(full, text, img);
  const page = { ...full, backgroundColor: colors.background };
  if (!stage.behind) return node(page, body);
  const back: OgNode = {
    type: 'img',
    props: { src: stage.behind, ...OG_SIZE, style: { position: 'absolute', top: 0, left: 0 } },
  };
  return node(page, back, node({ ...full, position: 'relative' }, body));
}

/** Every string the tree draws, in order. */
export function drawnStrings(tree: OgNode | string): string[] {
  if (typeof tree === 'string') return [tree];
  return (tree.props.children ?? []).flatMap(drawnStrings);
}

// The two faces the card draws, cut by scripts/fonts/build.sh as TrueType, which satori reads:
// Archivo Expanded SemiBold for the title, Archivo Expanded Medium for the label (ADR 0029).
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

function openFace(file: string) {
  const face = create(font(file));
  if (face.isCollection) throw new Error(`og.ts: ${file} is a collection, not a font`);
  return face;
}

let display: ReturnType<typeof openFace> | undefined;

/** The face titles are drawn in, read once. */
const titleFace = () => (display ??= openFace('archivo-expanded-semibold.ttf'));

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

/** The card's tree as an SVG: its text as paths, or with `embedFont` false as text a test can read
 *  back. */
export function ogSvg(tree: OgNode, embedFont = true): Promise<string> {
  return satori(tree as unknown as Parameters<typeof satori>[0], {
    ...OG_SIZE,
    embedFont,
    fonts: [
      {
        name: 'Archivo Display',
        data: font('archivo-expanded-semibold.ttf'),
        weight: 600,
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
}

/** The tree a card draws from, in the night theme's tokens, with its picture, a PNG, and its lab's
 *  colour on the lamp, when it has them. */
export function cardTree(card: OgCard, art: OgArt = {}): OgNode {
  const { picture, behind, titleColumn, line } = art;
  const uri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
  const colors = themeColors(tokensCss, 'dark');
  const token = (name: string) => {
    const value = colors.get(name);
    if (!value) throw new Error(`og.ts: tokens.css has no --${name}`);
    return hex(value);
  };
  return ogTree(
    card,
    {
      background: token('background'),
      foreground: token('foreground'),
      muted: token('muted-foreground'),
      accent: token(line ? `line-${line}` : 'primary'),
    },
    picture && {
      src: uri(picture),
      width: picture.readUInt32BE(16),
      height: picture.readUInt32BE(20),
    },
    { behind: behind && uri(behind), titleColumn },
  );
}

/** The card as a PNG, with no metadata chunks (scripts/image-metadata.mjs checks it again). */
export async function renderOg(card: OgCard, art: OgArt = {}): Promise<Buffer> {
  const svg = await ogSvg(cardTree(card, { ...art, behind: art.behind ?? (await fieldPicture()) }));
  return stripPng(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}
