import { asDay, KIND_LABELS, postPath, type Post } from './posts';

// /about/'s brief timeline (docs/design/overhaul.md, "/about/"; after taniarascia.com's): what
// Joseph has shipped here, newest first, a day at a time. Only facts the build already holds, each
// read from its one owner, never typed into a page: a post's day is its published date (its front
// matter), and a lab's is the day of the decision record its entry names (src/content/lab/*.md,
// "decisions"), whose status line is the record of when it was decided. The profile holds no roles
// yet (content.md, Q8), so the timeline holds no career dates: when it does, they join here. This
// module is pure; the page reads the records' first lines and passes them in.

/** One thing shipped: what it is, its title and the page that shows it. */
export interface TimelineItem {
  readonly kind: string;
  readonly title: string;
  readonly href: string;
}

/** A day of the timeline and what shipped on it, in the order the page lists them. */
export interface TimelineDay {
  readonly day: Date;
  readonly items: readonly TimelineItem[];
}

/** A lab as the timeline reads it: its page, its title and its decision records' numbers. */
export interface TimelineLab {
  readonly title: string;
  readonly href: string;
  readonly decisions: readonly string[];
}

/** A decision record's number and its file's text, as docs/adr/ holds it. */
export interface RecordFile {
  readonly name: string;
  readonly text: string;
}

/**
 * The day each decision record was written, by its four-digit number: the first day on its status
 * line, which opens "Status:" and names the day it was proposed or accepted. A
 * record whose name has no number, or whose status line has no day, is left out, so a lab that
 * names it has no day and no row: the timeline never guesses a date.
 */
export function recordDays(files: readonly RecordFile[]): Map<string, Date> {
  const days = new Map<string, Date>();
  for (const { name, text } of files) {
    const number = /^(\d{4})-/.exec(name)?.[1];
    const status = /^Status:[^\n]*?(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
    const day = status ? asDay(status) : null;
    if (number && day) days.set(number, day);
  }
  return days;
}

/**
 * The timeline: every published post on its day, and every lab on the earliest day of the records
 * it names, grouped by day, newest day first; within a day, posts before labs, each kind in its
 * given order. A lab with no dated record is left out.
 */
export function timeline(
  posts: readonly Post[],
  labs: readonly TimelineLab[],
  days: ReadonlyMap<string, Date>,
): TimelineDay[] {
  const dated: { day: Date; item: TimelineItem }[] = [
    ...posts.map((post) => ({
      day: post.published,
      item: { kind: KIND_LABELS[post.kind], title: post.title, href: postPath(post) },
    })),
    ...labs.flatMap((lab) => {
      const known = lab.decisions.map((n) => days.get(n)).filter((d): d is Date => d !== undefined);
      if (known.length === 0) return [];
      const day = new Date(Math.min(...known.map((d) => d.getTime())));
      return [{ day, item: { kind: 'Lab', title: lab.title, href: lab.href } }];
    }),
  ];
  const byDay = new Map<number, TimelineItem[]>();
  for (const { day, item } of dated) {
    const items = byDay.get(day.getTime()) ?? [];
    items.push(item);
    byDay.set(day.getTime(), items);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b - a)
    .map(([time, items]) => ({ day: new Date(time), items }));
}
