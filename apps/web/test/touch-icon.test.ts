import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { expect, test } from 'vitest';

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
