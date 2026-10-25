// The commit a build was made from, for machines only. astro.config.mjs writes it into the build's
// _headers, so every response carries it as X-Build and the deploy smoke can confirm which build is
// live (e2e/smoke.spec.ts). No page holds it (design-system.md, "Nothing on the page describes the
// site"). It is fixed when the build runs: each deploy ships the dist/ that was built and tested
// once (delivery.md, "Pipeline"). Plain JavaScript, so the config imports it as the tests do.
import { execFileSync } from 'node:child_process';

/** The full commit: CI's GITHUB_SHA, or the local checkout's HEAD. */
export const commit = (
  process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
).trim();

if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error('build.mjs: cannot read the commit this build was made from');
}

/** The header that names the commit, as _headers writes it under its "/*" rule. */
export const BUILD_HEADER = 'X-Build';

/**
 * A _headers file with the build header added to its "/*" rule, the rule every response matches.
 * @param {string} headers the _headers file public/ holds
 * @param {string} sha the commit
 * @returns {string}
 */
export function withBuildHeader(headers, sha) {
  const rule = /^\/\*\r?\n/m;
  if (!rule.test(headers))
    throw new Error('build.mjs: _headers has no "/*" rule to add X-Build to');
  return headers.replace(rule, (line) => `${line}  ${BUILD_HEADER}: ${sha}\n`);
}
