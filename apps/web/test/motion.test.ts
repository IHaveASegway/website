import { expect, test } from 'vitest';
import { titleFor } from '../src/scripts/motion.js';

// The motion module's one decision (src/scripts/motion.js; design-system.md, "Motion"). The browser
// half, that nothing else on the page moves and that no text changes under the pointer, is
// e2e/motion.spec.ts.

test('known answers: the title that leads to the next page, or none', () => {
  const lab = { name: 'lab' };
  const post = { name: 'post' };
  const links = [
    { element: 'a', path: '/lab/routes/', title: lab },
    { element: 'b', path: '/writing/a-post/', title: post },
  ];
  expect(titleFor(links, '/lab/routes/')).toBe(lab);
  expect(titleFor(links, '/writing/a-post/')).toBe(post);
  expect(titleFor(links, '/writing/')).toBeNull();
  expect(titleFor([], '/')).toBeNull();
});

// Home opens the Route Lab from its chapter and from the board (ADR 0025): the title beside the
// link the visitor followed flies, not the first that leads there.
test('known answers: of two titles that lead to one page, the followed link’s', () => {
  const chapter = { name: 'chapter' };
  const band = { name: 'band' };
  const links = [
    { element: 'chapter-link', path: '/lab/routes/', title: chapter },
    { element: 'band-link', path: '/lab/routes/', title: band },
  ];
  expect(titleFor(links, '/lab/routes/', 'band-link')).toBe(band);
  expect(titleFor(links, '/lab/routes/', 'chapter-link')).toBe(chapter);
  // A followed link elsewhere, the rail's, say: the first title that leads there.
  expect(titleFor(links, '/lab/routes/', 'rail-link')).toBe(chapter);
  expect(titleFor(links, '/lab/routes/')).toBe(chapter);
});
