import { execFileSync } from 'node:child_process';

// What the readout row reports about this build. Both values are fixed when the HTML is written:
// each deploy ships the dist/ that was built and tested once (delivery.md, "Pipeline").

/** The commit this build was made from: CI's GITHUB_SHA, or the local checkout's HEAD. */
const commit = (
  process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
).trim();

if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error('build.ts: cannot read the commit this build was made from');
}

/** The commit's short form, as git prints it. */
export const shortCommit = commit.slice(0, 7);

/** The build's date in UTC, as YYYY-MM-DD. No local time zone reaches the page. */
export const builtOn = new Date().toISOString().slice(0, 10);
