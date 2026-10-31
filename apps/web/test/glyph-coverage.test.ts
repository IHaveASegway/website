import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { create } from 'fontkitten';
import { expect, test } from 'vitest';
import { decodeReferences } from '../src/lib/held-names';
import { app, html, read } from './support/dist';

// The characters a post may use (design-system.md, "The faces"). Every face is a subset of Google's
// latin range: Latin-1 and common punctuation, and no arrow, which Barlow does not draw. e2e's glyph
// check sees a character outside them only on a published page, as a font a browser fell back to.
// This reads every post page in the build, a draft's included, splits its text by the face that
// draws it (titles and headings in Barlow Condensed, the register, the post's kind, day and tags, in
// Barlow Semi Condensed, bold in Barlow SemiBold, code in B612 Mono, the rest in Barlow) and names
// each missing character, with the way out, so a post fails with a sentence instead of a font name.

/** The characters a self-hosted face carries, read from its own cmap (the files fonts.test.ts locks). */
function face(file: string): Set<number> {
  const font = create(readFileSync(join(app, 'src/assets/fonts', file)));
  if (font.isCollection) throw new Error(`${file}: a font collection, not a font`);
  return new Set(font.characterSet);
}
const FACES = {
  display: {
    name: 'Barlow Condensed',
    where: 'a title or heading',
    file: 'barlow-condensed-semibold.woff2',
  },
  label: {
    name: 'Barlow Semi Condensed',
    where: 'a label',
    file: 'barlow-semi-condensed-medium.woff2',
  },
  text: { name: 'Barlow', where: 'the text', file: 'barlow-regular.woff2' },
  bold: { name: 'Barlow SemiBold', where: 'bold text', file: 'barlow-semibold.woff2' },
  mono: { name: 'B612 Mono', where: 'code', file: 'b612-mono-regular.woff2' },
} as const;
type Face = keyof typeof FACES;
const CHARS = Object.fromEntries(
  Object.entries(FACES).map(([key, { file }]) => [key, face(file)]),
) as Record<Face, Set<number>>;

const text = (markup: string) => decodeReferences(markup.replace(/<[^>]+>/g, ' '));

/** Every element's markup with the given tag names, and the markup with them taken out. */
function split(markup: string, tags: string): { inner: string[]; rest: string } {
  const pattern = new RegExp(`<(${tags})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'g');
  return {
    inner: [...markup.matchAll(pattern)].map(([, , inner = '']) => inner),
    rest: markup.replace(pattern, ' '),
  };
}

/** A post page's text, split by the face that draws it (global.css). Code is taken out first, so a
 *  code span in a heading is code; then headings, then bold. A page whose header, register or body
 *  the check cannot find throws: a check that reads nothing passes nothing. */
export function textByFace(page: string): Record<Face, string> {
  const head = /<header class="page-head">([\s\S]*?)<\/header>/.exec(page)?.[1];
  const register = /<ul class="register"[^>]*>([\s\S]*?)<\/ul>/.exec(page)?.[1];
  const body = /<div class="prose">([\s\S]*?)<\/div>(?=<ul class="post-links">|<\/article>)/.exec(
    page,
  )?.[1];
  const lost = [
    head === undefined && 'header.page-head',
    register === undefined && 'ul.register',
    body === undefined && 'div.prose',
  ].filter(Boolean);
  if (head === undefined || register === undefined || body === undefined) {
    throw new Error(
      `no ${lost.join(' or ')} on this post page: the layout changed, so change this check with it`,
    );
  }
  const code = split(body, 'code');
  const headings = split(code.rest, 'h[1-6]');
  const bold = split(headings.rest, 'strong|b');
  const title = split(head, 'h1');
  return {
    display: text([...title.inner, ...headings.inner].join(' ')),
    label: text(register),
    text: `${text(title.rest)} ${text(bold.rest)}`,
    bold: text(bold.inner.join(' ')),
    mono: text(code.inner.join(' ')),
  };
}

/** Each character a face does not carry, once, in the order it first appears. */
export function missing(chars: string, face: ReadonlySet<number>): string[] {
  const found = new Set<string>();
  for (const char of chars) {
    if (!/\s/.test(char) && !face.has(char.codePointAt(0) ?? 0)) found.add(char);
  }
  return [...found];
}

const codePoint = (char: string) =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/** Why a post page cannot be drawn in its own faces, one line per character. */
export function glyphProblems(page: string): string[] {
  const byFace = textByFace(page);
  return (Object.keys(FACES) as Face[]).flatMap((key) =>
    missing(byFace[key], CHARS[key]).map(
      (c) => `"${c}" (${codePoint(c)}) in ${FACES[key].where}: not in ${FACES[key].name}`,
    ),
  );
}

const FIX =
  'write the character another way, or re-cut the face with it (apps/web/scripts/fonts/build.sh), ' +
  'within the 70 KB preload budget (design-system.md)';

const posts = html.filter((file) => /^(writing|notes)\/[a-z0-9-]+\/index\.html$/.test(file));
for (const file of posts) {
  test(`${file}: every character is in the face that draws it`, () => {
    expect(glyphProblems(read(file)), `${file}: ${FIX}`).toEqual([]);
  });
}

test('known answers: a missing character is named with its code point and its face', () => {
  const page = (body: string, title = 'A title', label = 'Essay') =>
    `<header class="page-head"><h1 class="page-title">${title}</h1></header>` +
    `<ul class="register" role="list"><li class="register-kind">${label}</li><li>25 October 2026</li></ul>` +
    `<div class="prose">${body}</div></article>`;
  expect(glyphProblems(page('<p>Café, “quoted” – and <strong>façade</strong> back</p>'))).toEqual(
    [],
  );
  expect(glyphProblems(page('<p>p99 ≤ 2 s</p>'))).toEqual([
    '"≤" (U+2264) in the text: not in Barlow',
  ]);
  // Barlow draws no arrow, in any of its widths: the design writes words instead.
  expect(glyphProblems(page('<p>See below ↓</p>', 'Up ↗', 'Next →'))).toEqual([
    '"↗" (U+2197) in a title or heading: not in Barlow Condensed',
    '"→" (U+2192) in a label: not in Barlow Semi Condensed',
    '"↓" (U+2193) in the text: not in Barlow',
  ]);
  expect(glyphProblems(page('<h2>Then ← back</h2><p><b>Bold ←</b></p>'))).toEqual([
    '"←" (U+2190) in a title or heading: not in Barlow Condensed',
    '"←" (U+2190) in bold text: not in Barlow SemiBold',
  ]);
  expect(glyphProblems(page('<pre><code>├── src</code></pre>'))).toEqual([
    '"├" (U+251C) in code: not in B612 Mono',
    '"─" (U+2500) in code: not in B612 Mono',
  ]);
  // The same letter is fine in prose and missing in code: the faces are cut to one range, and B612
  // Mono has no dotless i. A code span inside a heading is code.
  expect(glyphProblems(page('<h2>On <code>ı</code></h2><p>ı</p>'))).toEqual([
    '"ı" (U+0131) in code: not in B612 Mono',
  ]);
  // A page the check cannot read fails: a body under another class, or no header, is not clean.
  expect(() =>
    glyphProblems(page('<p>≤</p>').replace('class="prose"', 'class="post-body"')),
  ).toThrow(/div\.prose/);
  expect(() =>
    glyphProblems(page('<p>a</p>').replace('class="page-head"', 'class="head"')),
  ).toThrow(/header\.page-head/);
  expect(() => glyphProblems(page('<p>a</p>').replace('class="register"', 'class="meta"'))).toThrow(
    /ul\.register/,
  );
});

test('every post page in this build is read: its body is found, so no page passes unread', () => {
  for (const file of posts)
    expect(textByFace(read(file)).text.trim().length, file).toBeGreaterThan(20);
});
