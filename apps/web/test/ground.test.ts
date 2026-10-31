import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { END_OF_LINE, groundFor, groundKindFor, type GroundKind } from '../src/lib/ground';
import { html, read } from './support/dist';

// Page geometry (design-system.md, "Page geometry"; lib/ground.ts): the background symbol, About's
// wheels (ADR 0025), fixed and small, and the 404's line, which ends in a buffer stop under its
// words. e2e/ground.spec.ts keeps the 404's one mark clear of text and checks the drawings are
// hidden in print.

const KINDS: GroundKind[] = ['about'];
const markup = (kind: GroundKind) =>
  groundFor(kind)
    .paths.map((p) => p.d)
    .join('');

// Writing's ruled sheet and the Lab's street plans went with ADR 0025: a rule is functional or a
// lab's line. On main at f65dcc1 those pages carried them. Until 2026-10-30 the 404 carried its
// buffer stop as a background drawing too ('lost'); it is in the 404's own flow now.
test('known answers: which drawing a path carries: the wheels on /about/, and none elsewhere', () => {
  expect(groundKindFor('/about/')).toBe('about');
  expect(groundKindFor(undefined)).toBeNull();
  for (const path of ['/', '/writing/', '/writing/a-post/', '/notes/', '/lab/', '/lab/routes/'])
    expect(groundKindFor(path), path).toBeNull();
  expect(groundKindFor('/colophon/')).toBeNull();
});

// The 404's drawing (ADR 0025): one track across the column that ends at its right edge in a
// buffer stop, under the way home, its lamp the one mark. As a background drawing anchored to the
// window's corner it ended past the column at 2560 px and touched the button at 390.
test('known answer: the 404 draws a line across its column that ends in a buffer stop, with its lamp lit', () => {
  const page = read('404.html');
  const drawing = /<svg class="line-end"[\s\S]*?<\/svg>\s*<\/svg>/.exec(page)?.[0] ?? '';
  expect(drawing).toContain('aria-hidden="true"');
  // The track from the column's left edge to its right.
  expect(drawing).toMatch(
    new RegExp(`<line class="line-end-track" x1="0" y1="${END_OF_LINE.track}" x2="100%"`),
  );
  // The stop and its lamp, drawn back from the right edge: the beam on the track, the lamp over it.
  expect(drawing).toContain('<svg x="100%" overflow="visible">');
  expect(drawing).toContain(`d="${END_OF_LINE.stop}"`);
  expect(drawing).toContain(`class="ground-mark" d="${END_OF_LINE.lamp}"`);
  const [, beamTop] = /^M-24 (\d+)h6v64h-6z/.exec(END_OF_LINE.stop) ?? [];
  expect(Number(beamTop) + 32).toBe(END_OF_LINE.track);
  expect(END_OF_LINE.lamp).toMatch(/^M-29 8a8 8 /);
  // Under the words, never behind them: the page carries no background drawing.
  expect(page).not.toMatch(/<svg class="ground"/);
});

describe.each(KINDS)('%s', (kind) => {
  test('the same kind draws the same picture, byte for byte', () => {
    expect(markup(kind)).toBe(markup(kind));
  });

  test('it weighs at most 2.5 KB gzip, and has at most one accent mark', () => {
    expect(gzipSync(markup(kind), { level: 9 }).length).toBeLessThanOrEqual(2_500);
    expect(groundFor(kind).paths.filter((p) => p.kind === 'mark').length).toBeLessThanOrEqual(1);
  });

  test('every coordinate is a whole number, so the markup stays small', () => {
    expect(markup(kind)).not.toMatch(/\d\.\d/);
  });
});

for (const file of html) {
  test(`${file}: carries its section's drawing once, or none on the résumé`, () => {
    const page = read(file);
    const found = [...page.matchAll(/<svg class="ground" data-ground="([a-z]+)"/g)].map(
      (m) => m[1],
    );
    const path = file === '404.html' ? undefined : `/${file.replace(/index\.html$/, '')}`;
    const kind = groundKindFor(path);
    expect(found).toEqual(kind ? [kind] : []);
    if (kind) expect(page).toMatch(/<svg class="ground"[^>]*aria-hidden="true"/);
  });
}
