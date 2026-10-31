import sharp from 'sharp';
import tokensCss from '../../styles/tokens.css?raw';
import { hex, themeColors } from '../tokens';
import { pathData, routeLine } from './legs';
import { basemap, isochrones, leg, routeData, routeLabPicture } from './picture';
import { BAKERY } from './plan';
import { isRound, vanClass } from './render';

// The Route Lab's link preview carries a picture of the demo beside its two strings: the busy
// Saturday as VROOM plans it, over the isochrone bands and the water, drawn at build from the same
// data and the same solve as the page's own maps (lib/og.ts). It draws no word: no label, no
// number, so the card's only text is still its title and its label, which the page's og:title and
// og:image:alt carry and every text scan reads. The colors are the dark theme's tokens, as the
// card's are. Build-time only.

/** The picture's size on the card: the full height of the canvas, at the map's own shape. */
export const OG_MAP = { width: 491, height: 630 } as const;

let drawn: Promise<Buffer> | undefined;

async function draw(app: string): Promise<Buffer> {
  const { after } = await routeLabPicture(app);
  const colors = themeColors(tokensCss, 'dark');
  const token = (name: string) => {
    const value = colors.get(name);
    if (!value) throw new Error(`og-map: tokens.css has no --${name}`);
    return hex(value);
  };
  const at = (i: number) => routeData.points[i] ?? { x: 0, y: 0 };
  const [x0, y0, width, height] = basemap.viewBox;
  // Sizes in map units: a map unit is about a quarter of a pixel on the card.
  const mark = (x: number, y: number, size: number, round: boolean, fill: string) =>
    round
      ? `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${fill}"/>`
      : `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="${fill}"/>`;
  const bands = [...isochrones.within.keys()]
    .reverse()
    .map(
      (k) =>
        `<path fill-rule="evenodd" fill="${token(`map-band-${k + 1}`)}" d="${isochrones.within[k]}"/>`,
    );
  const routes = after.plan.routes.map((route, van) =>
    route.length
      ? `<path fill="none" stroke="${token(`map-van-${vanClass(van)}`)}" stroke-width="16" stroke-linejoin="round" stroke-linecap="round" d="${pathData(routeLine(leg, [BAKERY, ...route, BAKERY]))}"/>`
      : '',
  );
  const stops = after.plan.routes.flatMap((route, van) =>
    route.map((i) => {
      const p = at(i);
      const round = isRound(van);
      return (
        mark(p.x, p.y, 58, round, token('background')) +
        mark(p.x, p.y, 42, round, token(`map-van-${vanClass(van)}`))
      );
    }),
  );
  const bakery = at(BAKERY);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${width} ${height}" width="${OG_MAP.width}" height="${OG_MAP.height}" preserveAspectRatio="xMidYMid slice">`,
    `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="${token('map-land')}"/>`,
    ...bands,
    `<path fill-rule="evenodd" fill="${token('map-water')}" d="${basemap.water}"/>`,
    ...routes,
    ...stops,
    mark(bakery.x, bakery.y, 76, false, token('background')),
    mark(bakery.x, bakery.y, 60, false, token('map-depot')),
    '</svg>',
  ].join('');
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** The picture a demo's link preview carries beside its strings, or none. `app` is apps/web. */
export function demoPicture(slug: string, app: string): Promise<Buffer> | undefined {
  if (slug !== 'routes') return undefined;
  drawn ??= draw(app);
  return drawn;
}
