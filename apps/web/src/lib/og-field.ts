import sharp from 'sharp';
import tokensCss from '../styles/tokens.css?raw';
import { hex, themeColors } from './tokens';

// What every link preview stands on, and the paints its pictures share: the field behind every page
// (ADR 0030, styles/field.css) drawn once across the card, so a card looks like the site it opens
// and not a black sheet. The colours are the night theme's tokens, as the card's are. Build-time
// only.

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** The grid's cell. A line of it runs at the card's 72 px margin, so the words stand on one. */
const CELL = 72;

const night = () => themeColors(tokensCss, 'dark');

/** A number as an SVG attribute: no run of digits a text scan would read as an identifier. */
export const n = (x: number) => Math.round(x * 1000) / 1000;

/** A token as an SVG paint and its opacity, since hex() drops a token's alpha. */
function ink(name: string): { readonly color: string; readonly opacity: number } {
  const value = night().get(name);
  if (!value) throw new Error(`og-field: tokens.css has no --${name}`);
  return { color: hex(value), opacity: value.alpha ?? 1 };
}

/** SVG fill attributes for a token, its alpha scaled by `share`. */
export function fill(name: string, share = 1): string {
  const { color, opacity } = ink(name);
  return `fill="${color}" fill-opacity="${n(opacity * share)}"`;
}

/** SVG stroke attributes for a token, to go with a fill. */
export function edge(name: string, width: number, share = 1): string {
  const { color, opacity } = ink(name);
  return `stroke="${color}" stroke-opacity="${n(opacity * share)}" stroke-width="${n(width)}"`;
}

/** SVG stroke attributes for a token, with no fill. */
export const stroke = (name: string, width: number, share = 1) =>
  `fill="none" ${edge(name, width, share)}`;

/** Shapes as an SVG the size of a card. */
export const cardSvg = (shapes: readonly string[], defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_SIZE.width}" height="${OG_SIZE.height}" viewBox="0 0 ${OG_SIZE.width} ${OG_SIZE.height}"><defs>${defs}</defs>${shapes.join('')}</svg>`;

export const svgPng = (text: string) =>
  sharp(Buffer.from(text)).png({ compressionLevel: 9 }).toBuffer();

/** How the veil closes from its hole, [share of its reach, opacity]: eased at both ends, since a
 *  straight ramp shows its end as a ring on a dark page. */
const VEIL = [
  [0, 0],
  [0.25, 0.12],
  [0.5, 0.5],
  [0.75, 0.86],
  [1, 1],
] as const;

const ALL = `width="${OG_SIZE.width}" height="${OG_SIZE.height}"`;

/** The field across a card, as the page builds it: the lit grid, a veil with one soft hole in it
 *  round (x, y), `reach` px across, then the grid everywhere. The page's own veil is the reason it
 *  takes no mask (styles/field.css), and a mask would need a white of its own here. */
export function field(x: number, y: number, reach: number): { defs: string; shapes: string[] } {
  const grid = (id: string, token: string) =>
    `<pattern id="${id}" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse"><path d="M0 0H${CELL}V1H1V${CELL}H0Z" ${fill(token)}/></pattern>`;
  const page = ink('background').color;
  return {
    defs: [
      grid('field-lit', 'field-line'),
      grid('field-grid', 'grid-line'),
      `<radialGradient id="field-veil" gradientUnits="userSpaceOnUse" cx="${n(x)}" cy="${n(y)}" r="${n(reach)}">${VEIL.map(([at, opacity]) => `<stop offset="${at}" stop-color="${page}" stop-opacity="${opacity}"/>`).join('')}</radialGradient>`,
    ].join(''),
    shapes: [
      `<rect ${ALL} ${fill('field-light')}/>`,
      `<rect ${ALL} fill="url(#field-lit)"/>`,
      `<rect ${ALL} fill="url(#field-veil)"/>`,
      `<rect ${ALL} fill="url(#field-grid)"/>`,
    ],
  };
}

let plain: Promise<Buffer> | undefined;

/** The field alone, lit at the card's top right, for a card with no picture of its own behind its
 *  words: the same bytes on every card, so it's drawn once. */
export function fieldPicture(): Promise<Buffer> {
  plain ??= (() => {
    const { defs, shapes } = field(OG_SIZE.width - CELL * 2, CELL * 2, 760);
    return svgPng(cardSvg(shapes, defs));
  })();
  return plain;
}
