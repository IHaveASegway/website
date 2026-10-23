import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { create } from 'fontkitten';
import { expect, test } from 'vitest';
import { decodeReferences } from '../src/lib/held-names';
import { app, html, read } from './support/dist';

// The characters a post may use (design-system.md, "The faces"). Both faces are subsets: the sans
// carries Latin-1 and common punctuation, the mono printable ASCII and a few symbols. e2e's glyph
// check sees a character outside them only on a published page, as a font a browser fell back to.
// This reads every post page in the build, a draft's included, splits its text by the face that
// draws it (code and labels in mono, the rest in sans) and names each missing character, with the
// way out, so a post fails with a sentence instead of a font name.

/** The characters a self-hosted face carries, read from its own cmap (the files fonts.test.ts locks). */
function face(file: string): Set<number> {
  const font = create(readFileSync(join(app, 'src/assets/fonts', file)));
  if (font.isCollection) throw new Error(`${file}: a font collection, not a font`);
  return new Set(font.characterSet);
}
const SANS = { name: 'Instrument Sans', chars: face('instrument-sans-latin.woff2') };
const MONO = { name: 'JetBrains Mono', chars: face('jetbrains-mono-c.woff2') };

const text = (markup: string) => decodeReferences(markup.replace(/<[^>]+>/g, ' '));

/** A post page's text, split by the face that draws it (global.css: labels, the meta line and
 *  code are mono; the heading, the lead and the body are sans). Labels are set in capitals. */
export function textByFace(page: string): { sans: string; mono: string } {
  const head = /<header class="page-head">([\s\S]*?)<\/header>/.exec(page)?.[1] ?? '';
  const label = /<p class="label">([\s\S]*?)<\/p>/.exec(head)?.[1] ?? '';
  const meta = /<p class="post-meta">([\s\S]*?)<\/p>/.exec(head)?.[1] ?? '';
  const body =
    /<div class="prose">([\s\S]*?)<\/div>(?=<ul class="post-links">|<\/article>)/.exec(page)?.[1] ??
    '';
  const code = [...body.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map(([, c = '']) => c);
  const headSans = head.replace(/<p class="(label|post-meta)">[\s\S]*?<\/p>/g, ' ');
  return {
    sans: `${text(headSans)} ${text(body.replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, ' '))}`,
    mono: `${text(label).toUpperCase()} ${text(meta)} ${text(code.join(' '))}`,
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
  const { sans, mono } = textByFace(page);
  return [
    ...missing(sans, SANS.chars).map(
      (c) => `"${c}" (${codePoint(c)}) in the text: not in ${SANS.name}`,
    ),
    ...missing(mono, MONO.chars).map(
      (c) => `"${c}" (${codePoint(c)}) in code or a label: not in ${MONO.name}`,
    ),
  ];
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
  const page = (body: string) =>
    '<header class="page-head"><p class="label">Essay</p><h1 class="page-title">A title</h1>' +
    `<p class="post-meta">2026-10-20</p></header><div class="prose">${body}</div></article>`;
  expect(glyphProblems(page('<p>Café, “quoted” – and ↑ back</p>'))).toEqual([]);
  expect(glyphProblems(page('<p>p99 ≤ 2 s</p>'))).toEqual([
    '"≤" (U+2264) in the text: not in Instrument Sans',
  ]);
  expect(glyphProblems(page('<pre><code>├── src</code></pre>'))).toEqual([
    '"├" (U+251C) in code or a label: not in JetBrains Mono',
    '"─" (U+2500) in code or a label: not in JetBrains Mono',
  ]);
  // The same accented letter is fine in prose and missing in code: the mono subset is ASCII.
  expect(glyphProblems(page('<p>é <code>é</code></p>'))).toEqual([
    '"é" (U+00E9) in code or a label: not in JetBrains Mono',
  ]);
});
