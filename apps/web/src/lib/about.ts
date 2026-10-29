import { z } from 'astro/zod';
import { asDay } from './posts';

// /about/ (content.md, "About"): who Joseph is and how he works, then his résumé. Two sources, one
// owner each: src/content/about.md holds the bio, his words, and profile.json holds every fact the
// résumé shows (lib/resume.ts). The page is built by every build, as the résumé it replaced was
// (2026-10-28; /resume/ now answers with a 301 to it, public/_redirects); the bio renders only
// where its entry exists, so the fixture builds, which hold none, still draw the résumé. The entry
// carries no title, lead or description: the nav names the page, and the profile states the facts.

const day = z
  .union([z.date(), z.string()])
  .refine((value) => asDay(value) !== null, 'a calendar day, YYYY-MM-DD, with no time or offset')
  .transform((value) => asDay(value) as Date);

export const aboutSchema = z.strictObject({
  firewall_reviewed: day,
});

export type About = z.infer<typeof aboutSchema>;

/** The page's URL. It replaced /resume/ on 2026-10-28 (ADR 0005: a move keeps the old URL in the
 *  ledger and gives it a 301). */
export const ABOUT_PATH = '/about/';

/** A principle in the bio's list: its bold opening sentence, and what follows it. */
export interface Principle {
  readonly lead: string;
  readonly text: string;
}

/** A section of the bio under its heading: a list of principles, or paragraphs. */
export interface AboutSection {
  readonly heading: string;
  readonly principles: readonly Principle[];
  readonly paragraphs: readonly string[];
}

/** The bio in the parts Home tells it in (ADR 0023): the paragraphs before the first heading, then
 *  each section. */
export interface AboutParts {
  readonly lede: readonly string[];
  readonly sections: readonly AboutSection[];
}

/** Markdown Home would show as its characters: a link, code, emphasis other than a list item's
 *  bold lead, HTML, an image (whose "![" opens with a bracket). The bio holds none today; when it does, the build stops here, rather
 *  than print brackets on Home, and this reader learns it. */
const UNREAD = /[[\]`_<>*]/;

const plain = (text: string, where: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (UNREAD.test(flat))
    throw new Error(`about.md: Home reads plain text only, and ${where} holds markup: "${flat}"`);
  return flat;
};

/**
 * Home's parts of the bio, read from its Markdown: paragraphs, "### " headings, and lists whose
 * items open with a bold sentence. The bio stays the one owner of its words, which Joseph cleared;
 * Home only lays them out, so a change to the bio changes /about/ and Home together.
 */
export function aboutParts(body: string): AboutParts {
  const [head = '', ...rest] = body.split(/^### +/m);
  const blocks = (text: string) =>
    text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);
  const lede = blocks(head).map((p, i) => plain(p, `the opening's paragraph ${i + 1}`));
  const sections = rest.map((chunk) => {
    const newline = chunk.indexOf('\n');
    const heading = plain(newline < 0 ? chunk : chunk.slice(0, newline), 'a heading');
    const principles: Principle[] = [];
    const paragraphs: string[] = [];
    for (const block of blocks(newline < 0 ? '' : chunk.slice(newline + 1))) {
      if (!block.startsWith('- ')) {
        paragraphs.push(plain(block, `"${heading}"`));
        continue;
      }
      for (const item of block.split(/^- /m).filter((i) => i.trim().length > 0)) {
        const found = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(item.trim());
        if (!found)
          throw new Error(`about.md: an item under "${heading}" does not open with a bold line`);
        principles.push({
          lead: plain(found[1] ?? '', `"${heading}"`),
          text: plain(found[2] ?? '', `"${heading}"`),
        });
      }
    }
    return { heading, principles, paragraphs };
  });
  return { lede, sections };
}

/** A run of text, or of text that links somewhere. */
export type Run = string | { readonly text: string; readonly href: string };

/** The text with each name it mentions turned into a link to its page, first mention only: the
 *  bio names the Route Lab and the Raft Lab, and on Home those words open them. A name whose page
 *  this build does not write stays text. */
export function withLinks(
  text: string,
  names: readonly { readonly name: string; readonly href: string }[],
): Run[] {
  let runs: Run[] = [text];
  for (const { name, href } of names) {
    const next: Run[] = [];
    let done = false;
    for (const run of runs) {
      const at = typeof run === 'string' && !done ? run.indexOf(name) : -1;
      if (typeof run !== 'string' || at < 0) {
        next.push(run);
        continue;
      }
      done = true;
      if (at > 0) next.push(run.slice(0, at));
      next.push({ text: name, href });
      if (at + name.length < run.length) next.push(run.slice(at + name.length));
    }
    runs = next;
  }
  return runs;
}
