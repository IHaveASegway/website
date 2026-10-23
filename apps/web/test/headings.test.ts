import { expect, test } from 'vitest';
import { html, read } from './support/dist';

// One <h1> per page, read from what the build wrote (design-system.md, "Accessibility rules"). A
// post's title is its page's <h1>, so a heading in a post's body must start at h2. The rule is
// checked on the rendered HTML, where every way of writing an h1 ends up the same: "# Title", a
// title underlined with "===", indented, or raw <h1> markup. axe's page-has-heading-one is not
// among the WCAG rules e2e runs, and it checks only that one exists.

/** The <h1> elements in a page, by their text. */
export function h1s(page: string): string[] {
  return [...page.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(([, text = '']) =>
    text.replace(/<[^>]+>/g, '').trim(),
  );
}

for (const file of html) {
  test(`${file} has exactly one <h1>`, () => {
    expect(h1s(read(file))).toHaveLength(1);
  });
}

test('known answers: a second h1 from a body is counted, whatever wrote it', () => {
  const page = '<h1 id="page-title" class="page-title">The title</h1><div class="prose">';
  expect(h1s(`${page}<h2>A section</h2></div>`)).toEqual(['The title']);
  expect(h1s(`${page}<h1 id="another">Another</h1></div>`)).toEqual(['The title', 'Another']);
  expect(h1s(`${page}<H1>Raw <em>markup</em></H1></div>`)).toEqual(['The title', 'Raw markup']);
});
