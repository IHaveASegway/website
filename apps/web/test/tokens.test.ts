import { readFileSync, readdirSync } from 'node:fs';
import { converter, inGamut, wcagContrast, type Color } from 'culori';
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

// Selected text (SC 1.4.3): global.css gives every ::selection rule a text color and a fill, each a
// token, so the pair is the whole story whatever color the text had, and it must reach 4.5:1 in
// both themes. A rule may instead set no fill (transparent), as display type does, whose lines
// overlap and would hide each other under one: its text color then sits on whatever surface the
// text does, so it must reach 4.5:1 on every surface. Until 2026-10-25 the fill was a 30% apricot
// tint and the text kept its own color, which left muted text under 4.5:1 in both themes (the
// known answer below measures it).
describe('selected text', () => {
  const globalCss = stripComments(
    readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8'),
  );

  interface SelectionRule {
    selector: string;
    color: string | undefined;
    /** A token's name, or "transparent" for no fill. */
    fill: string | undefined;
  }

  /** Every rule that styles ::selection, with the tokens its text color and fill name. */
  function selectionRules(text: string): SelectionRule[] {
    return [...text.matchAll(/([^{};]*::selection[^{};]*)\{([^}]*)\}/g)].map(
      ([, selector = '', body = '']) => {
        const fill =
          /(?:^|;)\s*background-color\s*:\s*(?:var\(--([\w-]+)\)|(transparent))\s*(?:;|$)/.exec(
            body,
          );
        return {
          selector: selector.replace(/\s+/g, ' ').trim(),
          color: /(?:^|;)\s*color\s*:\s*var\(--([\w-]+)\)\s*(?:;|$)/.exec(body)?.[1],
          fill: fill?.[1] ?? fill?.[2],
        };
      },
    );
  }

  /** Why a rule's selected text could fall under 4.5:1 in a theme, or null. */
  function selectionProblem(rule: SelectionRule, theme: keyof typeof themes): string | null {
    if (!rule.color || !rule.fill) return `${rule.selector}: set both a text color and a fill`;
    const fills = rule.fill === 'transparent' ? SURFACES : [rule.fill];
    const color = themes[theme].get(rule.color);
    if (!color) return `${rule.selector}: --${rule.color} is no token`;
    for (const name of fills) {
      const fill = themes[theme].get(name);
      if (!fill) return `${rule.selector}: --${name} is no token`;
      const ratio = wcagContrast(color, fill);
      if (ratio < 4.5) return `${rule.selector}: ${ratio.toFixed(2)}:1 on --${name} in ${theme}`;
    }
    return null;
  }

  const rules = selectionRules(globalCss);
  test('the page styles selected text, with a fill and, for display type, without one', () => {
    expect(rules.map((rule) => rule.selector)).toContain('::selection');
    expect(rules.map((rule) => rule.fill)).toContain('transparent');
  });

  for (const rule of rules) {
    const on = rule.fill === 'transparent' ? 'every surface' : `--${rule.fill}`;
    for (const theme of ['dark', 'light'] as const) {
      test(`${rule.selector}: --${rule.color} on ${on} reaches 4.5:1 in ${theme}`, () => {
        expect(selectionProblem(rule, theme)).toBeNull();
      });
    }
  }

  test('known answers: the 30% tint is refused, and measured under 4.5:1 for muted text', () => {
    const before =
      '::selection { background-color: color-mix(in oklab, var(--primary) 30%, transparent); }';
    const [old] = selectionRules(before);
    expect(old && selectionProblem(old, 'dark')).toBe(
      '::selection: set both a text color and a fill',
    );
    // What a browser painted: the apricot at 30% over the page, and the text in its own color.
    const rgb = converter('rgb');
    for (const theme of ['dark', 'light'] as const) {
      const [apricot, page, muted] = ['primary', 'background', 'muted-foreground'].map((name) =>
        rgb(themes[theme].get(name)),
      );
      if (!apricot || !page || !muted) throw new Error('tokens missing');
      const tint = {
        mode: 'rgb' as const,
        r: 0.3 * apricot.r + 0.7 * page.r,
        g: 0.3 * apricot.g + 0.7 * page.g,
        b: 0.3 * apricot.b + 0.7 * page.b,
      };
      expect(wcagContrast(muted, tint), theme).toBeLessThan(4.5);
    }
    const [now] = selectionRules(
      '::selection{background-color:var(--primary);color:var(--primary-foreground)}',
    );
    expect(now && selectionProblem(now, 'light')).toBeNull();
    const [weak] = selectionRules(
      '::selection{background-color:var(--surface-2);color:var(--border)}',
    );
    expect(weak && selectionProblem(weak, 'dark')).toMatch(
      /^::selection: 1\.\d\d:1 on --surface-2 in dark$/,
    );
  });

  test('known answers: no fill holds the text color to every surface', () => {
    const [clear, faint] = selectionRules(
      '.a::selection{background-color:transparent;color:var(--primary)}' +
        '.b::selection{background-color:transparent;color:var(--border)}',
    );
    expect(clear?.fill).toBe('transparent');
    expect(clear && selectionProblem(clear, 'light')).toBeNull();
    // --border clears no surface; the first one it fails is reported.
    expect(faint && selectionProblem(faint, 'dark')).toMatch(
      /^\.b::selection: \d\.\d\d:1 on --background in dark$/,
    );
  });
});

// SC 1.4.4 (Resize Text): a size in vw alone does not grow with zoom (WCAG failure F94). So every
// fluid size is a clamp() with a rem floor and a rem term, and its maximum stays within 2.5 times
// its minimum (Maxwell Barvian, "Addressing Accessibility Concerns With Using Fluid Type", 2023).
// A size may also stop at a width, min(<that clamp()>, <n>vw), only where the cap never binds at the
// default text size from 320px up, so zoom enlarges the text exactly as it would without the cap.
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

  /** The width SC 1.4.10 names, and the default text size browsers ship with, in px. */
  const REFLOW_PX = 320;
  const DEFAULT_PX = 16;

  function check(value: string): string | null {
    if (!/vw/.test(value)) return null;
    // The cap binds only when a larger default text size meets a narrow screen, where the text
    // could not grow without breaking a word or scrolling sideways (SC 1.4.10). At the default
    // size it must not bind from 320px up: n is at least the clamp's own vw rate, and n vw at
    // 320px is at least the size the clamp gives there.
    const capped = /^min\(\s*(clamp\(.*\))\s*,\s*([\d.]+)vw\s*\)$/.exec(value);
    if (capped) {
      const [, fluid = '', cap = '0'] = capped;
      const problem = check(fluid);
      if (problem) return problem;
      const terms =
        /^clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)rem\s*\+\s*([\d.]+)vw\s*,\s*([\d.]+)rem\s*\)$/.exec(
          fluid,
        );
      if (!terms) return 'a capped size outside min(clamp(<rem>, <rem> + <vw>, <rem>), <vw>)';
      const [min, rem, rate, max] = terms.slice(1).map(Number) as [number, number, number, number];
      const atReflow = Math.min(max, Math.max(min, rem + (rate * REFLOW_PX) / 100 / DEFAULT_PX));
      if (Number(cap) < rate || (Number(cap) * REFLOW_PX) / 100 < atReflow * DEFAULT_PX - 0.01)
        return `the ${cap}vw cap binds at the default text size from ${REFLOW_PX}px up`;
      return null;
    }
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
    // PR 2's cap: 16.5vw is 52.8px at 320px, under the 66px floor, so it bound up to 400px.
    expect(check('min(clamp(4.125rem, 2.036rem + 8.571vw, 9.75rem), 16.5vw)')).toBe(
      'the 16.5vw cap binds at the default text size from 320px up',
    );
    // The name's cap since 2026-10-25: 20vw is the 64px floor at 320px, and grows faster after.
    expect(check('min(clamp(4rem, 2.1429rem + 7.619vw, 9rem), 20vw)')).toBeNull();
    expect(check('min(clamp(4rem, 2.1429rem + 7.619vw, 9rem), 19vw)')).not.toBeNull();
    expect(check('min(clamp(1rem, 0.5rem + 30vw, 2rem), 25vw)')).not.toBeNull();
    expect(check('min(clamp(1rem, 0.5rem + 5vw, 3rem), 20vw)')).toBe('max/min is 3.00');
    expect(check('min(2rem, 20vw)')).not.toBeNull();
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
