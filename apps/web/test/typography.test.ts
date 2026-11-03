import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { typesetHtml } from '../src/lib/typeset-html.mjs';
import { typeset } from '../src/lib/typeset.mjs';
import { app, files, html, read } from './support/dist';
import { attribute, elementsOf, type Element } from './support/html';

// One kind of apostrophe on a page (lib/typeset.mjs). The Markdown pipeline curls a post's body, and
// until 2026-11-02 nothing else had it: Home's lead said "I've" with a typewriter mark over essays
// that said "week’s", /lab/ had three cards with one and two with the other, and a lab's own lines
// were all straight. So this reads what a reader reads, every page's text and what its head shows in
// a search result or a link preview, for a straight mark next to a word. e2e/typography.spec.ts reads
// the lines a lab writes once it runs.

/** A straight apostrophe or quotation mark that touches a word. */
const STRAIGHT = /\w['"]|['"]\w/;

/** Elements whose words are as they were typed. */
const AS_WRITTEN = new Set([
  'script',
  'style',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'textarea',
  'noscript',
  'template',
]);

/** The text of a page, a run per text node, leaving out what is as it was typed. */
function textRuns(page: string): string[] {
  const inCode = new Set<Element>();
  const runs: string[] = [];
  for (const element of elementsOf(page)) {
    if (AS_WRITTEN.has(element.tagName) || inCode.has(element.parentNode as Element)) {
      inCode.add(element);
      continue;
    }
    for (const child of element.childNodes)
      if ('value' in child && typeof child.value === 'string') runs.push(child.value);
  }
  return runs;
}

/** What a page's head gives a search result or a link preview. */
const headStrings = (page: string) =>
  elementsOf(page)
    .filter((element) => element.tagName === 'meta')
    .filter((meta) =>
      /^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)$/.test(
        attribute(meta, 'name') ?? attribute(meta, 'property') ?? '',
      ),
    )
    .map((meta) => attribute(meta, 'content') ?? '');

describe('every page has one kind of apostrophe', () => {
  for (const file of html) {
    test(file, () => {
      const page = read(file);
      expect(textRuns(page).filter((run) => STRAIGHT.test(run))).toEqual([]);
      expect(headStrings(page).filter((text) => STRAIGHT.test(text))).toEqual([]);
    });
  }

  // The two files a machine reads, whose lines are the pages' words too. The feed is XML, whose own
  // tags and attributes quote, so only its text is read.
  test.runIf(files.includes('llms.txt'))('llms.txt', () => {
    expect(
      read('llms.txt')
        .split('\n')
        .filter((line) => /\w'\w/.test(line)),
    ).toEqual([]);
  });

  test.runIf(files.includes('rss.xml'))('rss.xml', () => {
    const text = read('rss.xml').replace(/<[^>]*>/g, ' ');
    expect(text.split(/\s{2,}/).filter((line) => /\w'\w/.test(line))).toEqual([]);
  });
});

test('known answers: typeset curls a word, opens a quote and leaves the rest', () => {
  expect(typeset("I've")).toBe('I\u2019ve');
  expect(typeset("the vans' routes")).toBe('the vans\u2019 routes');
  expect(typeset('why "later" beats')).toBe('why \u201clater\u201d beats');
  expect(typeset("'Quoted' here")).toBe('\u2018Quoted\u2019 here');
  // A text node that starts on a possessive, its word in the element before it.
  expect(typeset("'s next load")).toBe('\u2019s next load');
  expect(typeset('Already \u2019 curly')).toBe('Already \u2019 curly');
});

describe('known answers: a page typeset once it is written', () => {
  const shell = (body: string) =>
    `<!doctype html><html><head><title>A</title></head><body>${body}</body></html>`;

  test('text changes, where it stands, and nothing else does', () => {
    expect(typesetHtml(shell("<p>I've <b>won't</b> and bakery&#39;s</p>"))).toBe(
      shell('<p>I\u2019ve <b>won\u2019t</b> and bakery\u2019s</p>'),
    );
    expect(typesetHtml(shell('<p>Fail <span>Monday</span>&#39;s next load</p>'))).toBe(
      shell('<p>Fail <span>Monday</span>\u2019s next load</p>'),
    );
    // Escapes come back as they were, so text can't turn into markup.
    expect(typesetHtml(shell("<p>a &lt;b&gt; &amp; it's</p>"))).toBe(
      shell('<p>a &lt;b&gt; &amp; it\u2019s</p>'),
    );
  });

  test('attributes, scripts, styles and code stay as they were, byte for byte', () => {
    for (const page of [
      `<p title="it's">x</p>`,
      `<script>const a = "it's";</script>`,
      `<style>p::after { content: "it's"; }</style>`,
      `<pre><code>don't</code></pre>`,
      `<p><code>it's</code></p>`,
      `<kbd>'</kbd>`,
    ])
      expect(typesetHtml(shell(page))).toBe(shell(page));
    // Beside code, the prose still turns.
    expect(typesetHtml(shell("<p>it's <code>it's</code></p>"))).toBe(
      shell("<p>it\u2019s <code>it's</code></p>"),
    );
  });

  test('the check reads what it says it reads: a straight mark in text or in the head is found', () => {
    const page = shell(
      `<p>it's <code>it's</code></p><meta name="description" content="it's"><meta name="x" content="it's">`,
    );
    expect(textRuns(page).filter((run) => STRAIGHT.test(run))).toEqual(["it's "]);
    expect(headStrings(page)).toEqual(["it's"]);
    expect(STRAIGHT.test('it\u2019s')).toBe(false);
  });
});

test('the build typesets a page with what its source would have left straight', () => {
  // Its own page file still says it straight, so this holds the step and not only the words.
  const source = readFileSync(join(app, 'src/pages/about/index.astro'), 'utf8');
  expect(source).toContain("I'll send a résumé");
  expect(read('about/index.html')).toContain('I\u2019ll send a résumé');
});
