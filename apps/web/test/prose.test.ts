import { expect, test } from 'vitest';
import { html, read } from './support/dist';
import { descendants, elementsOf, hasClass, markupOf } from './support/html';

// What a post's rendered body may hold (content.md, "Not yet"): no images yet. They need a WebP
// check, an image budget and an asset pipeline that keeps a draft's images out of production. The
// source check in writing.test.ts names a Markdown image early; this one reads what the Markdown
// processor wrote: an img, picture or source inside div.prose, so every form Markdown writes is
// caught, a reference-style or shortcut reference included. Raw HTML is not refused: it can close
// div.prose early, or show an image another way (an SVG image, an input type=image, a video's
// poster), which this check does not see. Run on every build (vitest.config.ts).

const IMAGES = new Set(['img', 'picture', 'source']);

/** Each image element inside a page's post body, div.prose, as the browser parses the page. */
export function imagesInProse(page: string): string[] {
  return elementsOf(page)
    .filter((element) => element.tagName === 'div' && hasClass(element, 'prose'))
    .flatMap(descendants)
    .filter((element) => IMAGES.has(element.tagName))
    .map(markupOf);
}

const posts = html.filter((file) => /^(writing|notes)\/[a-z0-9-]+\/index\.html$/.test(file));

for (const file of posts) {
  test(`${file}: the post's body shows no image`, () => {
    expect(imagesInProse(read(file)), `${file}: images in posts are not supported yet`).toEqual([]);
  });
}

test('known answers: an image in the body is named, in any form; one outside it is not', () => {
  const page = (body: string) =>
    `<header><img src="/logo.png" alt=""></header><article><div class="prose">${body}</div></article>`;
  expect(imagesInProse(page('<p>Text only.</p>'))).toEqual([]);
  // What satteri writes for ![a chart](./chart.png), and for the same image as a shortcut
  // reference, ![a chart] with [a chart]: ./chart.png below it: the same element either way.
  expect(imagesInProse(page('<p><img src="./chart.png" alt="a chart"></p>'))).toEqual([
    '<img src="./chart.png" alt="a chart">',
  ]);
  expect(
    imagesInProse(
      page(
        '<picture><source srcset="/a.avif" type="image/avif"><img src="/a.png" alt=""></picture>',
      ),
    ),
  ).toEqual([
    '<picture>',
    '<source srcset="/a.avif" type="image/avif">',
    '<img src="/a.png" alt="">',
  ]);
  // Inside a nested element, and in a body whose class list holds more than one class.
  expect(
    imagesInProse(
      '<div class="prose wide"><blockquote><p><img src="/b.png" alt=""></p></blockquote></div>',
    ),
  ).toHaveLength(1);
  // Code that shows the markup is text, not an image.
  expect(imagesInProse(page('<pre><code>&lt;img src="x.png"&gt;</code></pre>'))).toEqual([]);
});
