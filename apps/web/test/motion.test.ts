import { expect, test } from 'vitest';
import { titleFor } from '../src/scripts/motion.js';

// The motion module's one decision (src/scripts/motion.js; design-system.md, "Motion"). The browser
// half, that nothing else on the page moves and that no text changes under the pointer, is
// e2e/motion.spec.ts.

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
