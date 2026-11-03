// Typographer's quotes for words that pass through code. The Markdown pipeline curls a post's body,
// and nothing else gets that: front matter, the bio, a page's own words, a lab's lines. So a page held
// "I've" beside "week's" (2026-11-02), two sets of text a careful reader could tell apart. Three places
// call this: each collection's front matter (lib/posts.ts, lib/lab.ts) and the bio (lib/about.ts), since
// those reach attributes and files too; every page's text once it is written (lib/typeset-html.mjs);
// and a lab's app, with the log and the line the labs share (lib/lab), where they write words in the
// browser. It has no imports, so a lab's chunk can carry it. test/typography.test.ts reads the build
// for what got past.

/**
 * An apostrophe inside or at the end of a word is ’. A quote that opens after a space, a dash or a
 * bracket is ‘ or “, and any other is ’ or ”. A text node can start on a possessive whose word is in
 * the element before it, as in "<span>Monday</span>'s", so a lone 's at the start is never an opening.
 * @param {string} text
 * @returns {string}
 */
export function typeset(text) {
  return text
    .replace(/(^|[\s([{\u2014\u2013-])"/g, '$1\u201c')
    .replace(/"/g, '\u201d')
    .replace(/(^|[\s([{\u2014\u2013-])'(?!s\b)(?=\S)/g, '$1\u2018')
    .replace(/'/g, '\u2019');
}

/**
 * The same for a lab's own lines, which hold apostrophes and no quotes, in the fewest bytes, since
 * each lab's chunk carries it and has a budget to keep: a lab calls this where it writes its words.
 * @param {string} text
 * @returns {string}
 */
export const curled = (text) => text.replace(/'/g, '\u2019');
