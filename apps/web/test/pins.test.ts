import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { app } from './support/dist';

// Packages this app names itself that must be the very copy Astro resolves, read from the lockfile,
// which is what installs. A version update can move one without the other: Dependabot proposes
// each package's newest version, and Astro pins its own. Both arrive in one grouped pull request
// (dependabot.yml, minor-and-patch), and this check fails that pull request until they agree again.
//
//   @astrojs/markdown-satteri  astro.config.mjs hands Astro a processor built with it, to set the
//                              footnote's way back. Astro depends on an exact version; a second
//                              copy would be a processor this Astro was not released with.
//   yaml                       test/support/front-matter.ts reads post front matter with it, to read
//                              dates as Astro does; Astro reads them through @astrojs/internal-helpers.
const PINS = [
  { name: '@astrojs/markdown-satteri', via: ['astro'] },
  { name: 'yaml', via: ['astro', '@astrojs/internal-helpers'] },
] as const;

interface Lockfile {
  importers: Record<string, Record<string, Record<string, { version: string }> | undefined>>;
  snapshots: Record<string, { dependencies?: Record<string, string> } | null>;
}

/** A version without the peer suffix pnpm adds to a snapshot key: 7.4.2(yaml@2.9.1) is 7.4.2. */
const bare = (version: string) => version.replace(/\(.*$/, '');

/** What the importer resolves a package to, from its dependencies or its devDependencies. */
const direct = (lock: Lockfile, importer: string, name: string): string | undefined => {
  const entry = lock.importers[importer];
  return entry?.['dependencies']?.[name]?.version ?? entry?.['devDependencies']?.[name]?.version;
};

/**
 * Why the importer's copy of `name` is not the one Astro resolves through `via` (astro, then each
 * package it depends on in turn), or nothing when they are the same version.
 */
export function pinProblems(
  lock: Lockfile,
  importer: string,
  name: string,
  via: readonly string[],
): string[] {
  const ours = direct(lock, importer, name);
  if (ours === undefined) return [`${importer} does not depend on ${name}`];
  const [first = '', ...rest] = via;
  let at = direct(lock, importer, first);
  if (at === undefined) return [`${importer} does not depend on ${first}`];
  let key = `${first}@${at}`;
  for (const step of [...rest, name]) {
    at = lock.snapshots[key]?.dependencies?.[step];
    if (at === undefined) return [`${key} does not depend on ${step}`];
    key = `${step}@${at}`;
  }
  return bare(ours) === bare(at)
    ? []
    : [
        `${importer} has ${name} ${bare(ours)}; ${via.join(' > ')} resolves ${bare(at)}. Pin the same version.`,
      ];
}

const lock = parse(readFileSync(join(app, '../../pnpm-lock.yaml'), 'utf8')) as Lockfile;

describe('the pins match the versions Astro resolves', () => {
  for (const { name, via } of PINS) {
    test(`${name} is the copy ${via.join(' > ')} resolves`, () => {
      expect(pinProblems(lock, 'apps/web', name, via)).toEqual([]);
    });
  }
});

test('known answers: the lockfile with either side moved fails, naming both versions', () => {
  const satteri = '@astrojs/markdown-satteri';
  const ours = structuredClone(lock);
  const pinned = ours.importers['apps/web']?.['dependencies']?.[satteri];
  if (!pinned) throw new Error('apps/web has no @astrojs/markdown-satteri in the lockfile');
  pinned.version = '0.4.4';
  expect(pinProblems(ours, 'apps/web', satteri, ['astro'])).toEqual([
    `apps/web has ${satteri} 0.4.4; astro resolves 0.4.5. Pin the same version.`,
  ]);

  const theirs = structuredClone(lock);
  const astro = `astro@${direct(theirs, 'apps/web', 'astro')}`;
  const deps = theirs.snapshots[astro]?.dependencies;
  if (!deps) throw new Error(`${astro} has no snapshot`);
  deps[satteri] = '0.5.0';
  expect(pinProblems(theirs, 'apps/web', satteri, ['astro'])).toHaveLength(1);

  expect(pinProblems(lock, 'apps/web', 'left-pad', ['astro'])).toEqual([
    'apps/web does not depend on left-pad',
  ]);
  expect(pinProblems(lock, 'apps/web', 'yaml', ['astro', 'not-a-dependency'])).toHaveLength(1);
});
