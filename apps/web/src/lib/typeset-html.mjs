import { parse } from 'parse5';
import { typeset } from './typeset.mjs';

// Every page's text, typeset once it is written (astro.config.mjs, "typeset"), so a word that passes
// through code reads as a post's body does however it got to the page: a page's own words, a lab's
// lines drawn at build, and whatever comes next. Only text changes, each node where it stands, so
// the rest of the page is left byte for byte, and the build's policy still holds for its scripts and
// styles. Attributes aren't read: what a reader sees from them, a description or a link preview,
// comes from sources typeset before they get here.

/** Elements whose words are what they are: code says what was typed, and scripts aren't words. */
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

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u00a0': '&nbsp;' };
const escaped = (text) => text.replace(/[&<>\u00a0]/g, (character) => ESCAPES[character]);

/**
 * The page with its text typeset.
 * @param {string} html
 * @returns {string}
 */
export function typesetHtml(html) {
  const edits = [];
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text') {
        const value = typeset(child.value);
        if (value !== child.value && child.sourceCodeLocation)
          edits.push({ ...child.sourceCodeLocation, value: escaped(value) });
      } else if (!AS_WRITTEN.has(child.nodeName)) walk(child);
    }
  };
  walk(parse(html, { sourceCodeLocationInfo: true }));
  // From the end, so an edit leaves the offsets before it true.
  return edits
    .sort((a, b) => b.startOffset - a.startOffset)
    .reduce(
      (page, { startOffset, endOffset, value }) =>
        page.slice(0, startOffset) + value + page.slice(endOffset),
      html,
    );
}
