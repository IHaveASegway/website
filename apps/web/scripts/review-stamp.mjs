// The review stamp (delivery.md, "Quality gates"; content.md, "firewall_reviewed"). An entry a person
// writes carries the day someone last read all of it: firewall_reviewed in an essay's, a note's,
// a case study's, a lab write-up's or /now/'s front matter, and meta.firewall_reviewed in
// profile.json. A pull request that changes such an entry must carry a stamp from a read made for
// it, judged against two days, both in UTC: the day of the base commit and the day of the pull
// request's head commit.
//
//   - A changed entry needs a new stamp, or an unchanged one equal to the head commit's day: an
//     honest re-read on the day the stamp already names.
//   - A stamp never moves backwards, and is never later than the head commit's day.
//   - An added entry's stamp is on or after the base commit's day. A renamed or copied entry is an
//     added one (git's rename detection is off), so it cannot bring an old stamp along.
//
//   node apps/web/scripts/review-stamp.mjs <base> <head> [<day-of>]
//
// <base> and <head> are the commits whose contents are compared; <day-of> is the commit whose day
// is the head's, <head> itself unless named (CI names the pull request's own head commit, since it
// compares the merge commit). Exit 0: every changed entry passes. 1: an entry does not; each is
// named. 2: the check could not run, which fails it too: an error is never read as clean.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The entries that carry a stamp, as repository paths. */
export const STAMPED = [
  /^apps\/web\/src\/content\/(writing|notes|work|lab)\/[^/]+\.mdx?$/,
  /^apps\/web\/src\/content\/now\.md$/,
  /^apps\/web\/src\/content\/profile\.json$/,
];

export const isStamped = (path) => STAMPED.some((pattern) => pattern.test(path));

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const STAMP_LINE = /^firewall_reviewed[ \t]*:(.*)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An entry's stamp, and the entry without it, so two versions can be compared. */
export function stampOf(path, text) {
  if (path.endsWith('.json')) {
    const data = JSON.parse(text);
    const stamp = data?.meta?.firewall_reviewed ?? null;
    if (data?.meta) delete data.meta.firewall_reviewed;
    return { stamp: stamp === null ? null : String(stamp), rest: JSON.stringify(data) };
  }
  const match = FRONT_MATTER.exec(text);
  if (!match) return { stamp: null, rest: text };
  const lines = (match[1] ?? '').split(/\r?\n/);
  const line = lines.find((l) => STAMP_LINE.test(l));
  const stamp =
    line === undefined
      ? null
      : (STAMP_LINE.exec(line)?.[1] ?? '')
          .replace(/\s+#.*$/, '')
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2') || null;
  const rest = `---\n${lines.filter((l) => l !== line).join('\n')}\n---\n${text.slice(match[0].length)}`;
  return { stamp, rest };
}

const READ_AGAIN = 'Read the whole entry again, then set firewall_reviewed to the day you did.';

/**
 * Why one entry's change may not merge, or null. `before` is null for an added entry, `after` for
 * a removed one. `days` are the UTC days, YYYY-MM-DD, of the base commit and of the head commit.
 */
export function verdict(path, before, after, days) {
  if (after === null) return null;
  const now = stampOf(path, after);
  if (now.stamp === null) return `${path}: no firewall_reviewed date. ${READ_AGAIN}`;
  if (!DAY.test(now.stamp)) return `${path}: firewall_reviewed is not a day, YYYY-MM-DD.`;
  if (now.stamp > days.head) {
    return `${path}: firewall_reviewed ${now.stamp} is after the head commit's day, ${days.head}.`;
  }
  if (before === null) {
    return now.stamp < days.base
      ? `${path}: a new, renamed or copied entry stamped ${now.stamp}, before the base commit's day, ${days.base}. ${READ_AGAIN}`
      : null;
  }
  const then = stampOf(path, before);
  if (then.stamp !== null && now.stamp < then.stamp) {
    return `${path}: firewall_reviewed moved back, from ${then.stamp} to ${now.stamp}. A stamp only moves forward.`;
  }
  if (now.rest === then.rest || now.stamp !== then.stamp || now.stamp === days.head) return null;
  return `${path} changed, but its firewall_reviewed date is still ${now.stamp}. ${READ_AGAIN}`;
}

/** git, run at the top of the repository that holds `cwd`, so paths are repository paths. */
function gitIn(cwd) {
  const run = (dir, args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const top = run(cwd, ['rev-parse', '--show-toplevel']).trim();
  return (args) => run(top, args);
}

/** A commit's committer date, as a UTC day. */
const dayOf = (git, commit) =>
  new Date(Number(git(['show', '-s', '--format=%ct', commit]).trim()) * 1000)
    .toISOString()
    .slice(0, 10);

/** Every stamped entry that changed from base to head: [path before, path after], null for none.
 *  Renames are off: a renamed entry is a removed one and an added one. */
export function changes(base, head, cwd = process.cwd()) {
  const git = gitIn(cwd);
  const fields = git([
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    base,
    head,
    '--',
    'apps/web/src/content',
  ])
    .split('\0')
    .filter(Boolean);
  const found = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? '';
    const path = fields[i + 1] ?? '';
    if (isStamped(path)) found.push([status === 'A' ? null : path, status === 'D' ? null : path]);
  }
  return found;
}

/** The problems between two commits, one line each. */
export function check(base, head, cwd = process.cwd(), dayCommit = head) {
  const git = gitIn(cwd);
  const days = { base: dayOf(git, base), head: dayOf(git, dayCommit) };
  const textAt = (commit, path) => git(['show', `${commit}:${path}`]);
  return changes(base, head, cwd).flatMap(([from, to]) => {
    const problem = verdict(
      to ?? from ?? '',
      from === null ? null : textAt(base, from),
      to === null ? null : textAt(head, to),
      days,
    );
    return problem === null ? [] : [problem];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head, dayCommit] = process.argv.slice(2);
  if (!base || !head) {
    console.error(
      'review-stamp: usage: node apps/web/scripts/review-stamp.mjs <base> <head> [<day-of>]',
    );
    process.exit(2);
  }
  let problems;
  try {
    problems = check(base, head, process.cwd(), dayCommit ?? head);
  } catch (error) {
    console.error(`review-stamp: cannot check: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  if (problems.length === 0) {
    console.log('review-stamp: every changed entry carries a current firewall_reviewed date');
    process.exit(0);
  }
  for (const problem of problems) console.error(`review-stamp: ${problem}`);
  process.exit(1);
}
