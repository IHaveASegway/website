import { labPath, type LabArea } from './lab';
import type { NavItem } from './nav';
import { postPath, SECTION_LABELS, type WritingArea } from './posts';
import { checkedProfiles, homeDescription, type Profile, type ProjectCard } from './profile';
import { CONTACT_EMAIL, ORIGIN } from './site';

// /llms.txt (content.md, "Files for crawlers"): the site in the llms.txt convention, a Markdown
// file with an H1, a one-line summary in a blockquote and sections of links (llmstxt.org). Robots
// welcomes AI crawlers (Q15); this is what they read first. Every line comes from what the pages
// render: the profile, the contact address, the nav manifest's pages, the lab's demos, the
// published posts and the project cards, through the same functions, so the file cannot say what
// the site does not.
// A section with nothing in it is left out, as on a page.

export interface LlmsSources {
  readonly profile: Profile;
  /** The manifest items whose page this build writes (lib/nav.ts). */
  readonly pages: readonly NavItem[];
  readonly area: WritingArea;
  /** The lab's live demos (lib/lab.ts). */
  readonly lab: LabArea;
  /** Home's project cards (lib/profile.ts, projectCards). */
  readonly projects: readonly ProjectCard[];
}

/** Text for a Markdown link's label: brackets and backslashes escaped. */
const label = (text: string) => text.replace(/[\\[\]]/g, '\\$&');
/** One line of plain text, whatever the source's line breaks. */
const line = (text: string) => text.replace(/\s+/g, ' ').trim();
const onSite = (path: string) => new URL(path, ORIGIN).href;

function item(name: string, url: string, note?: string): string {
  return `- [${label(name)}](${url})${note ? `: ${line(note)}` : ''}`;
}

function section(title: string, items: readonly string[]): string[] {
  return items.length > 0 ? [`## ${title}`, '', ...items, ''] : [];
}

/** The file, byte for byte: the same sources always make the same bytes. */
export function llmsText({ profile, pages, area, lab, projects }: LlmsSources): string {
  const listed = [
    { label: 'Home', href: '/' },
    // Pages only: a manifest item that names a file, such as the feed, is not one.
    ...pages.filter((page) => page.href.endsWith('/')),
    // A section's index is a page even where the manifest has no item for it (/notes/).
    ...area.sections.map((s) => ({ label: SECTION_LABELS[s], href: `/${s}/` })),
  ].filter((page, i, all) => all.findIndex((other) => other.href === page.href) === i);
  const posts = (s: keyof typeof SECTION_LABELS) =>
    area.visible
      ? area.published
          .filter((post) => post.section === s)
          .map((post) => item(post.title, onSite(postPath(post)), post.summary))
      : [];
  return [
    `# ${line(profile.basics.name)}`,
    '',
    `> ${homeDescription(profile)}`,
    '',
    ...section('Contact', [
      item('Email', `mailto:${CONTACT_EMAIL}`),
      ...checkedProfiles(profile).map((p) => item(p.network, p.url)),
    ]),
    ...section(
      'Pages',
      listed.map((page) => item(page.label, onSite(page.href))),
    ),
    ...section(
      'Lab',
      lab.entries.map((entry) => item(entry.title, onSite(labPath(entry)), entry.summary)),
    ),
    ...section(SECTION_LABELS.writing, posts('writing')),
    ...section(SECTION_LABELS.notes, posts('notes')),
    ...section(
      'Projects',
      projects.map((card) => item(card.title, card.link.href, card.text)),
    ),
  ].join('\n');
}
