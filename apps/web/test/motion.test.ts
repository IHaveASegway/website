import { expect, test } from 'vitest';
import { GLYPHS, scramble, titleFor } from '../src/scripts/motion.js';

// The motion module's two decisions (src/scripts/motion.js; design-system.md, "Motion"). The
// browser half, that a hovered tag decodes and settles and that reduced motion keeps it still, is
// e2e/motion.spec.ts.

test('known answers: a decode frame keeps the word’s length, settles from the left, and keeps punctuation', () => {
  const pick = () => 'X';
  expect(scramble('Postmortem', 0, pick)).toBe('XXXXXXXXXX');
  expect(scramble('Postmortem', 0.5, pick)).toBe('PostmXXXXX');
  expect(scramble('Postmortem', 1, pick)).toBe('Postmortem');
  expect(scramble('Lab · demo', 0, pick)).toBe('XXX · XXXX');
  // Out of range clamps, so a late frame never shows more than the word.
  expect(scramble('Lab', 2, pick)).toBe('Lab');
  expect(scramble('Lab', -1, pick)).toBe('XXX');
  for (const progress of [0, 0.3, 0.7])
    expect(scramble('Postmortem', progress, pick)).toHaveLength(10);
});

test('the cycling letters are capitals and digits only: one advance in a mono face, no lookalikes', () => {
  expect(GLYPHS).toMatch(/^[A-Z0-9]+$/);
  for (const lookalike of ['I', 'O', 'Q']) expect(GLYPHS).not.toContain(lookalike);
});

test('known answers: the title that leads to the next page, or none', () => {
  const lab = { name: 'lab' };
  const post = { name: 'post' };
  const links = [
    { path: '/lab/routes/', title: lab },
    { path: '/writing/a-post/', title: post },
  ];
  expect(titleFor(links, '/lab/routes/')).toBe(lab);
  expect(titleFor(links, '/writing/a-post/')).toBe(post);
  expect(titleFor(links, '/writing/')).toBeNull();
  expect(titleFor([], '/')).toBeNull();
});
