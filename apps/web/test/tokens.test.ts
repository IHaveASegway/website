import { readFileSync } from 'node:fs';
import { inGamut, parse, wcagContrast, type Color } from 'culori';
import { describe, expect, test } from 'vitest';

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
const NON_TEXT = ['ring', 'input', 'ok'];
/** Text drawn on an accent fill, such as a button label, against each fill it sits on. */
const ON_FILL: Record<string, string[]> = { 'primary-foreground': ['primary', 'primary-strong'] };
/** Decoration only: no contrast claim, but still inside sRGB. */
const DECORATIVE = ['border', 'grid-line'];
/** Pairs a design must never draw; each is listed with its reason (none yet). */
const FORBIDDEN: [string, string][] = [];

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The body of the first `{ ... }` block that follows `marker`, braces balanced. */
function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`tokens.css has no block for ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

/** The custom properties declared directly in a block, without nested blocks. */
function declarations(body: string): Map<string, string> {
  const flat = body.replace(/\{[^{}]*\}/g, '');
  const found = new Map<string, string>();
  for (const [, name, value] of flat.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    if (name && value) found.set(name, value.trim());
  }
  return found;
}

/** Resolves var() references within one theme and parses each value as a color. */
function resolve(theme: Map<string, string>): Map<string, Color> {
  const colors = new Map<string, Color>();
  const valueOf = (name: string, seen: string[] = []): string => {
    const raw = theme.get(name);
    if (raw === undefined) throw new Error(`--${name} is not declared in this theme`);
    if (seen.includes(name)) throw new Error(`--${name} refers to itself`);
    const reference = /^var\(--([\w-]+)\)$/.exec(raw);
    return reference?.[1] ? valueOf(reference[1], [...seen, name]) : raw;
  };
  for (const name of theme.keys()) {
    // A theme block holds colors only: a value culori cannot read would escape every check below.
    const color = parse(valueOf(name));
    if (!color) throw new Error(`--${name} is not a color this test can read`);
    colors.set(name, color);
  }
  return colors;
}

// The default :root block is the dark theme; the light theme overrides it under its media query.
const rootStart = css.indexOf(':root');
const dark = declarations(block(css.slice(rootStart), ':root'));
const lightOverrides = declarations(
  block(block(css, '@media (prefers-color-scheme: light)'), ':root'),
);
const themes = {
  dark: resolve(dark),
  light: resolve(new Map([...dark, ...lightOverrides])),
};

test('both themes declare the same color tokens, so light never inherits a dark value', () => {
  const colorNames = [...themes.dark.keys()].sort();
  expect([...lightOverrides.keys()].sort()).toEqual(expect.arrayContaining(colorNames));
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
