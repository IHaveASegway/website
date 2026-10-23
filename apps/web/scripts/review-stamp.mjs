// The review stamp (delivery.md, "Quality gates"; content.md, "firewall_reviewed"). An entry a person
// writes carries the date someone last read all of it: firewall_reviewed in an essay's, a note's,
// a case study's, a lab write-up's or /now/'s front matter, and meta.firewall_reviewed in
// profile.json. A pull request that changes such an entry, anything in it but that date, must
// change the date too: an edit nobody re-read does not merge.
//
//   node apps/web/scripts/review-stamp.mjs <base> <head>
//
// Run from the repository; git reads both versions of every entry that changed between the two
// commits, so no checkout of the base is needed, only its objects. Exit 0: every changed entry has
// a new stamp, or changed nothing but its stamp. 1: an entry changed without one; each is named.
// 2: the check could not run, which fails it too: an error is never read as clean.
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

/** Why one entry's change may not merge, or null. `before` is null for a new entry, `after` for a
 *  removed one. */
export function verdict(path, before, after) {
  if (after === null) return null;
  const now = stampOf(path, after);
  if (before === null) {
    return now.stamp === null
      ? `${path}: a new entry with no firewall_reviewed date. Read all of it, then set the date.`
      : null;
  }
  const then = stampOf(path, before);
  if (now.rest === then.rest) return null; // only the stamp changed, or nothing did
  if (now.stamp !== null && now.stamp !== then.stamp) return null;
  return `${path} changed, but its firewall_reviewed date did not. Read the whole entry again, then set firewall_reviewed to that day.`;
}

/** git, run at the top of the repository that holds `cwd`, so paths are repository paths. */
function gitIn(cwd) {
  const run = (dir, args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const top = run(cwd, ['rev-parse', '--show-toplevel']).trim();
  return (args) => run(top, args);
}

/** Every stamped entry that changed from base to head: [path before, path after], null for none. */
export function changes(base, head, cwd = process.cwd()) {
  const git = gitIn(cwd);
  const fields = git([
    'diff',
    '--name-status',
    '-z',
    '-M',
    base,
    head,
    '--',
    'apps/web/src/content',
  ])
    .split('\0')
    .filter(Boolean);
  const found = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++] ?? '';
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = fields[i++] ?? '';
      const to = fields[i++] ?? '';
      if (isStamped(from) || isStamped(to)) found.push([from, to]);
    } else {
      const path = fields[i++] ?? '';
      if (!isStamped(path)) continue;
      found.push([status === 'A' ? null : path, status === 'D' ? null : path]);
    }
  }
  return found;
}

/** The problems between two commits, one line each. */
export function check(base, head, cwd = process.cwd()) {
  const git = gitIn(cwd);
  const textAt = (commit, path) => git(['show', `${commit}:${path}`]);
  return changes(base, head, cwd).flatMap(([from, to]) => {
    const problem = verdict(
      to ?? from ?? '',
      from === null ? null : textAt(base, from),
      to === null ? null : textAt(head, to),
    );
    return problem === null ? [] : [problem];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('review-stamp: usage: node apps/web/scripts/review-stamp.mjs <base> <head>');
    process.exit(2);
  }
  let problems;
  try {
    problems = check(base, head);
  } catch (error) {
    console.error(`review-stamp: cannot check: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  if (problems.length === 0) {
    console.log('review-stamp: every changed entry carries a new firewall_reviewed date');
    process.exit(0);
  }
  for (const problem of problems) console.error(`review-stamp: ${problem}`);
  process.exit(1);
}
