import { readFileSync, readdirSync } from 'node:fs';
import { inGamut, wcagContrast, type Color } from 'culori';
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
/** Decoration only: no contrast claim, but still inside sRGB. */
const DECORATIVE = ['border'];
/** Pairs a design must never draw; each is listed with its reason (none yet). */
const FORBIDDEN: [string, string][] = [];

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
  });
}

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
      // The card's bar and the view transition are the two motions C ships; both are guarded.
      expect(found.length).toBeGreaterThanOrEqual(2);
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
