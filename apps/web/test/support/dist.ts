import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileSchema, type Profile } from '../../src/lib/profile';

// What the checks over the build share: where the build is, its files, its pages, and the profile.

export const app = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The build these checks read: dist/, or another build when TEST_DIST names one. vitest.config.ts
 * runs every check over dist/ again on dist-preview/ and on three fixture builds with posts in
 * them (fixture-many, fixture-many-preview, fixture-two-preview), so a page type that only exists
 * once there is content (a post, an index, the feed) meets the same checks as Home before any real
 * post ships.
 */
export const fixture: string | undefined = process.env['TEST_DIST'] || undefined;
export const dist = join(app, fixture ?? 'dist');

/**
 * Whether this build may hold drafts: only a build TEST_DIST names whose project says DRAFTS=include
 * (vitest.config.ts: dist-preview/ and the preview fixtures). dist/ is the build that deploys, and
 * the checks hold it to production's rules whatever DRAFTS says: a backstop that does not depend
 * on the switch it guards.
 */
export const previewBuild = fixture !== undefined && process.env['DRAFTS'] === 'include';

if (!existsSync(join(dist, 'index.html'))) {
  throw new Error(
    fixture
      ? `apps/web/${fixture}/ is missing: build the fixtures first (pnpm --filter web build:fixtures)`
      : 'apps/web/dist/ is missing: build the site before running these tests (pnpm build)',
  );
}

/** Every file under a directory, as a path relative to it with forward slashes. */
export function filesIn(dir: string): string[] {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) => {
      const path = join(at, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(dir).map((path) => relative(dir, path).split(sep).join('/'));
}

/** Every file in the build, as a path relative to it with forward slashes. */
export const files = filesIn(dist);

/**
 * What a file in dist/ is, from its bytes rather than its name, so a new extension, or none, cannot
 * slip past the scans. A binary the scans cannot read is one of the kinds below, each with a check
 * of its own: PNG and ICO images (image metadata, og.test.ts), WOFF2 fonts (fonts.test.ts). Any
 * other file must be UTF-8 text, which every text scan reads. dist-files.test.ts fails on the rest.
 */
export type Kind = 'png' | 'ico' | 'woff2' | 'text' | 'unreadable';

const SIGNATURES: readonly [Exclude<Kind, 'text' | 'unreadable'>, readonly number[]][] = [
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['ico', [0x00, 0x00, 0x01, 0x00]],
  ['woff2', [0x77, 0x4f, 0x46, 0x32]], // "wOF2"
];

export function kindOf(data: Uint8Array): Kind {
  for (const [kind, signature] of SIGNATURES) {
    if (data.length >= signature.length && signature.every((byte, i) => data[i] === byte))
      return kind;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return 'unreadable';
  }
  // Valid UTF-8 can still be a binary: text holds no control character but tab and line breaks.
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 && (code < 0x09 || code > 0x0d)) || code === 0x7f) return 'unreadable';
  }
  return 'text';
}

/** Every file's kind, read once. */
export const kinds: ReadonlyMap<string, Kind> = new Map(
  files.map((file) => [file, kindOf(readFileSync(join(dist, file)))]),
);

/** Files whose bytes are text a person or a crawler can read: every text scan reads these. */
export const textFiles = files.filter((file) => kinds.get(file) === 'text');

export const html = files.filter((file) => file.endsWith('.html'));

export const read = (file: string): string => readFileSync(join(dist, file), 'utf8');
export const bytes = (file: string): Buffer => readFileSync(join(dist, file));

/** The dist/ file a root-relative URL points at. */
export const fileFor = (url: string): string =>
  decodeURIComponent(new URL(url, 'https://x/').pathname.slice(1));

/** The profile, through the same schema the build validates it with. */
export const profile: Profile = profileSchema.parse(
  JSON.parse(readFileSync(join(app, 'src/content/profile.json'), 'utf8')),
);
