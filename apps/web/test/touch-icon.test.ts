import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { hex, themeColors } from '../src/lib/tokens';

// The touch icon's wheel is drawn last, filled with the tile's enamel, so neither the rider's leg
// nor the stem shows inside it (design-system.md, "Icons"). Read from the PNG iOS shows, at 180 px,
// which `pnpm --filter web icons` renders from the SVG: until 2026-10-25 the leg and the stem,
// drawn after the wheel, filled most of it, and the center was the rider's color.
const svg = readFileSync(new URL('../icons/touch-icon.svg', import.meta.url), 'utf8');
const png = fileURLToPath(new URL('../public/apple-touch-icon.png', import.meta.url));

const tile = /<rect [^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
const [, ...place] =
  /translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\) translate\(([\d.-]+) ([\d.-]+)\)/.exec(svg) ??
  [];
const [, ...ring] =
  /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"[^>]*stroke-width="([\d.]+)"/.exec(svg) ?? [];

/** The wheel's center and the inner edge of its ring, in the viewBox (32 × 32). */
function wheel(): { cx: number; cy: number; inner: number } {
  if (place.length !== 5 || ring.length !== 4) throw new Error('the icon has no placed wheel');
  const [x, y, scale, dx, dy] = place.map(Number) as [number, number, number, number, number];
  const [cx, cy, r, stroke] = ring.map(Number) as [number, number, number, number];
  return { cx: (cx + dx) * scale + x, cy: (cy + dy) * scale + y, inner: (r - stroke / 2) * scale };
}

/** Every pixel color inside the ring, short of its inner edge by one pixel, as #rrggbb. */
async function insideTheWheel(image: string | Buffer): Promise<string[]> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = info.width / 32;
  const { cx, cy, inner } = wheel();
  const [x0, y0, radius] = [cx * px, cy * px, inner * px - 1];
  const seen = new Set<string>();
  for (let y = Math.ceil(y0 - radius); y <= y0 + radius; y++) {
    for (let x = Math.ceil(x0 - radius); x <= x0 + radius; x++) {
      if ((x + 0.5 - x0) ** 2 + (y + 0.5 - y0) ** 2 > radius ** 2) continue;
      const at = (y * info.width + x) * info.channels;
      seen.add(
        '#' + [...data.subarray(at, at + 3)].map((v) => v.toString(16).padStart(2, '0')).join(''),
      );
    }
  }
  return [...seen];
}

// The icons are the near-black page and the one accent (ADR 0029), as the top bar's wordmark is. They
// sit outside src/, in files a browser asks for by name, so tokens.css can't reach them: this holds
// each to the night theme's --background and --primary, the SVGs by what they say and the files a
// client downloads by their pixels, so a new palette can't leave them behind again. The tab icon and
// the touch icon stayed dark green and cream for a day after ADR 0029.
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => {
  const value = themeColors(tokens, 'dark').get(name);
  if (!value) throw new Error(`tokens.css has no --${name}`);
  return hex(value);
};
const GROUND = token('background');
const MARK = token('primary');
const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');

/** Every colour an SVG names. */
const named = (source: string) =>
  [...new Set(source.match(/#[0-9a-f]{3,8}\b/gi))].map((color) => color.toLowerCase()).sort();

/** The two colours a picture holds most of, most first, as #rrggbb, its transparent corners aside. */
async function mainColors(image: string | Buffer): Promise<string[]> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Map<string, number>();
  for (let at = 0; at < data.length; at += info.channels) {
    if ((data[at + 3] ?? 0) < 255) continue;
    const color = `#${[...data.subarray(at, at + 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    seen.set(color, (seen.get(color) ?? 0) + 1);
  }
  return [...seen]
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color)
    .slice(0, 2);
}

/** The PNGs an ICO file holds, by the sizes in its directory (scripts/icons.mjs writes PNG entries). */
function icoImages(ico: Buffer): { size: number; png: Buffer }[] {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + 16 * i;
    const [length, offset] = [ico.readUInt32LE(entry + 8), ico.readUInt32LE(entry + 12)];
    return { size: ico.readUInt8(entry), png: ico.subarray(offset, offset + length) };
  });
}

test('the icons name only the night page and the accent, and their files draw in those', async () => {
  const palette = [GROUND, MARK].sort();
  expect(named(favicon)).toEqual(palette);
  expect(named(svg)).toEqual(palette);
  expect(await mainColors(png)).toEqual([GROUND, MARK]);
  const images = icoImages(readFileSync(new URL('../public/favicon.ico', import.meta.url)));
  expect(images.map((image) => image.size)).toEqual([16, 32, 48]);
  for (const { size, png: image } of images) {
    expect((await sharp(image).metadata()).width, `${size} px`).toBe(size);
    expect(await mainColors(image), `${size} px`).toEqual(expect.arrayContaining([GROUND, MARK]));
  }
});

test('known answers: an old palette is what this finds, in the name and in the pixels', async () => {
  expect(named('<rect fill="#22322a"/><path stroke="#F9F3D1"/>')).toEqual(['#22322a', '#f9f3d1']);
  const old = await sharp({
    create: { width: 8, height: 8, channels: 4, background: '#22322a' },
  })
    .png()
    .toBuffer();
  expect(await mainColors(old)).toEqual(['#22322a']);
});

test('the touch icon is 180 px square and shows only the tile inside its wheel', async () => {
  expect(tile, 'the tile has a fill').toBeDefined();
  const { width, height } = await sharp(png).metadata();
  expect([width, height]).toEqual([180, 180]);
  // At 180 px the ring's inner edge is (4.25 - 2.5 / 2) × 0.8 × 5.625 = 13.5 px from the center.
  expect(wheel().inner * (180 / 32)).toBeCloseTo(13.5);
  expect(await insideTheWheel(png)).toEqual([tile]);
});

test('known answer: a mark inside the wheel is found', async () => {
  const { cx, cy } = wheel();
  const marked = await sharp({
    create: { width: 180, height: 180, channels: 3, background: tile ?? '#000000' },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">' +
            `<circle cx="${cx * 5.625}" cy="${cy * 5.625}" r="3" fill="#f9f3d1"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  expect(await insideTheWheel(marked)).toContain('#f9f3d1');
});
