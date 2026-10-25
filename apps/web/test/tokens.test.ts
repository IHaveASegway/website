import { readFileSync, readdirSync } from 'node:fs';
import {
  differenceCiede2000,
  differenceEuclidean,
  filterDeficiencyDeuter,
  filterDeficiencyProt,
  filterDeficiencyTrit,
  inGamut,
  wcagContrast,
  type Color,
} from 'culori';
import { describe, expect, test } from 'vitest';
import { SELECTORS, block, stripComments, themeBlocks, themeColors } from '../src/lib/tokens';
import { files, read } from './support/dist';

// The contrast claim belongs to this test, not to a comment (ADR 0010). It reads tokens.css,
// resolves every color token in both themes, and checks each text and non-text token against
// every surface: the cross product, not a hand-picked list, because a fitness function only
// guards what it declares (design-system.md, "Measured contrast").

const SURFACES = ['background', 'surface-1', 'surface-2'];
/** Text: 4.5:1 on every surface (SC 1.4.3). */
const TEXT = [
  'foreground',
  'muted-foreground',
  'subtle-foreground',
  'primary',
  'primary-strong',
  'signal',
  'destructive',
];
/** Non-text: focus outlines, functional borders and indicators, 3:1 on every surface (SC 1.4.11). */
const NON_TEXT = ['ring', 'input'];
/** Text drawn on an accent fill, such as a button label, against each fill it sits on. */
const ON_FILL: Record<string, string[]> = { 'primary-foreground': ['primary', 'primary-strong'] };
/** Decoration only: no contrast claim, but still inside sRGB. The map's streets and roads are
 *  hairlines under the routes: they place the routes and carry nothing a reader needs. */
const DECORATIVE = ['border', 'map-street', 'map-road', 'map-road-major'];
/** Pairs a design must never draw; each is listed with its reason (none yet). */
const FORBIDDEN: [string, string][] = [];

// The Route Lab's map (design-system.md, "Map colors"; ADR 0016). Its fills are the surfaces of
// the map: the land is the page's background, then water, parks and the six isochrone bands. Every
// mark on the map (each van's route and stops, a place, the bakery) meets 3:1 against every fill,
// since a route crosses all of them, and a label meets 4.5:1. The same cross product as above.
const MAP_FILLS = [
  'background',
  'map-water',
  'map-park',
  'map-band-1',
  'map-band-2',
  'map-band-3',
  'map-band-4',
  'map-band-5',
  'map-band-6',
];
const MAP_MARKS = [
  'map-van-a',
  'map-van-b',
  'map-van-c',
  'map-van-d',
  'map-place',
  'map-depot',
  'map-contour',
];
const MAP_TEXT = ['map-label'];
/** The vans whose stops share a mark's shape (lib/route-lab/render.ts, isRound): A and D draw
 *  squares, B and C circles. */
const SAME_SHAPE: [string, string][] = [
  ['map-van-a', 'map-van-d'],
  ['map-van-b', 'map-van-c'],
];

const deltaOk = differenceEuclidean('oklab');
const deltaE = differenceCiede2000();
const DEFICIENCIES = {
  protanopia: filterDeficiencyProt(1),
  deuteranopia: filterDeficiencyDeuter(1),
  tritanopia: filterDeficiencyTrit(1),
};

/** Two colors as far apart as a reader with each color-vision deficiency sees them: the smallest
 *  CIEDE2000 difference after Machado's simulation at full severity. */
export const apartUnderDeficiency = (a: Color, b: Color): number =>
  Math.min(...Object.values(DEFICIENCIES).map((simulate) => deltaE(simulate(a), simulate(b))));

/** How far each band must sit from its neighbour and from the water: in OKLab, where 0.02 is about
 *  one just-noticeable step. Until 2026-10-25 the bands stepped 0.031 to 0.038 and light band 4
 *  sat 0.013 from the water, so a reader could not tell them apart (review, 2026-10-25). */
const BAND_STEP = 0.045;
/** How far two vans that share a shape must stay apart under each deficiency, in CIEDE2000. */
const SHAPE_APART = 20;

const source = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const css = stripComments(source);
const blocks = themeBlocks(source);
const themes = { dark: themeColors(source, 'dark'), light: themeColors(source, 'light') };

describe('the theme blocks', () => {
  test('light from the OS is the same block as light by choice, so the copy cannot drift', () => {
    expect(Object.fromEntries(blocks.lightFromOs)).toEqual(Object.fromEntries(blocks.light));
  });

  test('light redeclares every color token dark declares, so light never inherits a dark value', () => {
    expect([...blocks.light.keys()].sort()).toEqual([...blocks.dark.keys()].sort());
  });

  test('the contrast and print blocks come last, and name [data-theme] so they outrank every theme', () => {
    const contrast = css.indexOf('@media (prefers-contrast: more)');
    const print = css.indexOf('@media print');
    for (const at of [contrast, print]) {
      expect(at).toBeGreaterThan(css.indexOf(SELECTORS.lightMedia));
      expect(at).toBeGreaterThan(css.indexOf(SELECTORS.light));
    }
    for (const media of ['@media (prefers-contrast: more)', '@media print']) {
      expect(() => block(block(css, media), ':root, :root[data-theme]'), media).not.toThrow();
    }
  });
});

test('every color token has a declared role', () => {
  const roles = new Set([
    ...SURFACES,
    ...TEXT,
    ...NON_TEXT,
    ...Object.keys(ON_FILL),
    ...DECORATIVE,
    ...MAP_FILLS,
    ...MAP_MARKS,
    ...MAP_TEXT,
  ]);
  const unclassified = [...themes.dark.keys()].filter((name) => !roles.has(name));
  expect(unclassified, 'add each new token to a role in this test').toEqual([]);
  for (const name of roles) expect(themes.dark.has(name), `--${name} is declared`).toBe(true);
});

for (const [themeName, colors] of Object.entries(themes)) {
  describe(`${themeName} theme`, () => {
    const get = (name: string): Color => {
      const color = colors.get(name);
      if (!color) throw new Error(`--${name} is missing or not a color`);
      return color;
    };
    const forbidden = (a: string, b: string) => FORBIDDEN.some(([x, y]) => x === a && y === b);

    test('every value is inside sRGB, so no browser clips it', () => {
      const outside = [...colors]
        .filter(([, color]) => !inGamut('rgb')(color))
        .map(([name]) => name);
      expect(outside).toEqual([]);
    });

    for (const surface of SURFACES) {
      for (const name of TEXT.filter((t) => !forbidden(t, surface))) {
        test(`${name} on ${surface} reaches 4.5:1`, () => {
          expect(wcagContrast(get(name), get(surface))).toBeGreaterThanOrEqual(4.5);
        });
      }
      for (const name of NON_TEXT.filter((t) => !forbidden(t, surface))) {
        test(`${name} on ${surface} reaches 3:1`, () => {
          expect(wcagContrast(get(name), get(surface))).toBeGreaterThanOrEqual(3);
        });
      }
    }

    for (const [name, fills] of Object.entries(ON_FILL)) {
      for (const fill of fills) {
        test(`${name} on ${fill} reaches 4.5:1`, () => {
          expect(wcagContrast(get(name), get(fill))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    for (const fill of MAP_FILLS) {
      for (const name of MAP_MARKS) {
        test(`map: ${name} on ${fill} reaches 3:1`, () => {
          expect(wcagContrast(get(name), get(fill))).toBeGreaterThanOrEqual(3);
        });
      }
      for (const name of MAP_TEXT) {
        test(`map: ${name} on ${fill} reaches 4.5:1`, () => {
          expect(wcagContrast(get(name), get(fill))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    test('map: each band is a step nearer the foreground than the band outside it', () => {
      const foreground = get('foreground');
      const bands = [6, 5, 4, 3, 2, 1].map((k) => wcagContrast(get(`map-band-${k}`), foreground));
      for (let k = 1; k < bands.length; k++) expect(bands[k]).toBeLessThan(bands[k - 1] ?? 0);
    });

    test(`map: each band sits ${BAND_STEP} or more from its neighbour and from the water`, () => {
      for (let k = 1; k <= 6; k++) {
        const band = get(`map-band-${k}`);
        if (k < 6)
          expect(deltaOk(band, get(`map-band-${k + 1}`)), `band ${k}`).toBeGreaterThan(BAND_STEP);
        expect(deltaOk(band, get('map-water')), `band ${k} and the water`).toBeGreaterThan(
          BAND_STEP,
        );
      }
    });

    for (const van of ['map-van-a', 'map-van-b', 'map-van-c', 'map-van-d']) {
      test(`map: a stop's number, the background on ${van}, reaches 4.5:1`, () => {
        expect(wcagContrast(get('background'), get(van))).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const [a, b] of SAME_SHAPE) {
      test(`map: ${a} and ${b} share a shape, so they stay ${SHAPE_APART} apart under every color-vision deficiency`, () => {
        expect(apartUnderDeficiency(get(a), get(b))).toBeGreaterThanOrEqual(SHAPE_APART);
      });
    }
  });
}

test('known answer: a band lightened until a route on it drops below 3:1 fails the map check', () => {
  const dark = themeColors(source, 'dark');
  const van = dark.get('map-van-a');
  const band = dark.get('map-band-1');
  if (!van || !band) throw new Error('tokens.css lost a map token');
  expect(wcagContrast(van, band)).toBeGreaterThanOrEqual(3);
  const lighter = { ...band, l: 0.6 } as Color;
  expect(wcagContrast(van, lighter)).toBeLessThan(3);
});

// The known answers for the bands' steps and the vans' shapes: the values of 2026-10-24, which the
// review found a reader could not tell apart, fail; and so would vans A and C sharing a shape.
test('known answer: the bands of 2026-10-24 fail the step check, and vans A and C could not share a shape', () => {
  const old = (l: number, c: number, h: number) => ({ mode: 'oklch', l, c, h }) as Color;
  expect(deltaOk(old(0.445, 0.07, 205), old(0.41, 0.066, 208))).toBeLessThan(BAND_STEP);
  expect(deltaOk(old(0.89, 0.034, 209), old(0.89, 0.035, 230))).toBeLessThan(BAND_STEP);
  const light = themeColors(source, 'light');
  const [a, c] = [light.get('map-van-a'), light.get('map-van-c')];
  if (!a || !c) throw new Error('tokens.css lost a van');
  expect(apartUnderDeficiency(a, c)).toBeLessThan(SHAPE_APART);
});

// SC 1.4.4 (Resize Text): a size in vw alone does not grow with zoom (WCAG failure F94). So every
// fluid size is a clamp() with a rem floor and a rem term, and its maximum stays within 2.5 times
// its minimum (Maxwell Barvian, "Addressing Accessibility Concerns With Using Fluid Type", 2023).
describe('fluid type', () => {
  /** Every font size the stylesheets declare: --text-* tokens and font-size properties. */
  const styles = readdirSync(new URL('../src/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'))
    .map((name) =>
      stripComments(readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')),
    );
  const sizes = styles.flatMap((text) =>
    [...text.matchAll(/(--text-[\w-]+|font-size)\s*:\s*([^;]+);/g)]
      .filter(([, name = '']) => !name.includes('--', 2))
      .map(([, name = '', value = '']) => ({ name, value: value.trim() })),
  );

  function check(value: string): string | null {
    if (!/vw/.test(value)) return null;
    const clamp = /^clamp\(\s*([\d.]+)rem\s*,\s*([^,]+),\s*([\d.]+)rem\s*\)$/.exec(value);
    if (!clamp) return 'a vw size outside clamp(<rem>, <rem> + <vw>, <rem>)';
    const [, min = '0', preferred = '', max = '0'] = clamp;
    if (!/[\d.]+rem/.test(preferred)) return 'the preferred size has no rem term';
    if (Number(max) / Number(min) > 2.5)
      return `max/min is ${(Number(max) / Number(min)).toFixed(2)}`;
    return null;
  }

  test('there are fluid sizes to check', () => {
    expect(sizes.filter(({ value }) => value.includes('vw')).length).toBeGreaterThan(3);
  });

  for (const { name, value } of sizes) {
    test(`${name}: ${value}`, () => expect(check(value)).toBeNull());
  }

  test('known answers: what the check refuses and what it accepts', () => {
    expect(check('min(clamp(4.125rem, 2.036rem + 8.571vw, 9.75rem), 16.5vw)')).not.toBeNull();
    expect(check('16.5vw')).not.toBeNull();
    expect(check('clamp(1rem, 5vw, 2rem)')).toBe('the preferred size has no rem term');
    expect(check('clamp(1rem, 0.5rem + 5vw, 3rem)')).toBe('max/min is 3.00');
    expect(check('clamp(4.125rem, 2.0357rem + 8.5714vw, 9.75rem)')).toBeNull();
    expect(check('1.25rem')).toBeNull();
  });
});

// Motion is authored inside prefers-reduced-motion: no-preference only (design-system.md,
// "Motion"). Read from the CSS that ships, so a utility class or a plugin cannot slip one past.
describe('motion lives only under prefers-reduced-motion: no-preference', () => {
  const MOTION = /^(transition|transition-[a-z-]+|animation|animation-[a-z-]+)$/;

  /** Every motion declaration and @view-transition rule, with the at-rules around it. */
  function motion(text: string): { what: string; inside: string[] }[] {
    const found: { what: string; inside: string[] }[] = [];
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== '{' && c !== '}' && c !== ';') continue;
      const chunk = text.slice(start, i).trim();
      if (c === '{') {
        if (chunk.startsWith('@view-transition'))
          found.push({ what: '@view-transition', inside: [...stack] });
        stack.push(chunk);
      } else if (chunk.includes(':')) {
        const property = chunk.slice(0, chunk.indexOf(':')).trim();
        const value = chunk.slice(chunk.indexOf(':') + 1).trim();
        if (MOTION.test(property) && !/^(none|0s?)$/.test(value))
          found.push({ what: chunk, inside: [...stack] });
        if (property === 'scroll-behavior' && value === 'smooth')
          found.push({ what: chunk, inside: [...stack] });
      }
      if (c === '}') stack.pop();
      start = i + 1;
    }
    return found;
  }
  const guarded = ({ inside }: { inside: string[] }) =>
    inside.some((prelude) => /prefers-reduced-motion:\s*no-preference/.test(prelude));

  const shipped = files.filter((file) => file.endsWith('.css'));
  test('the build ships a stylesheet', () => expect(shipped.length).toBeGreaterThan(0));

  for (const file of shipped) {
    test(`${file}`, () => {
      const found = motion(read(file));
      expect(found.filter((m) => !guarded(m)).map((m) => m.what)).toEqual([]);
      // The stylesheet every page links ships the card's bar and the view transition, both
      // guarded. The Route Lab's own sheet ships one, the maps' fade (ADR 0016), guarded too.
      if (read(file).includes('.rl-map'))
        expect(found.map((m) => m.what)).toEqual(['transition:opacity .22s ease-out']);
      else expect(found.length).toBeGreaterThanOrEqual(2);
    });
  }

  test('known answers', () => {
    expect(motion('.a{transition:opacity .2s}').filter((m) => !guarded(m))).toHaveLength(1);
    expect(motion('@view-transition{navigation:auto}').filter((m) => !guarded(m))).toHaveLength(1);
    expect(motion('html{scroll-behavior:smooth}').filter((m) => !guarded(m))).toHaveLength(1);
    expect(
      motion('@media (prefers-reduced-motion:no-preference){.a{transition:opacity .2s}}').filter(
        (m) => !guarded(m),
      ),
    ).toHaveLength(0);
    expect(motion('.a{transition:none}')).toHaveLength(0);
  });
});
