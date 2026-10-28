import { getCollection, getEntry } from 'astro:content';
import { aboutBuilt } from './about';
import { fromLab, labArea, type LabArea, type LabEntry } from './lab';
import {
  draftsIncluded,
  fromEssay,
  fromNote,
  writingArea,
  type Post,
  type WritingArea,
} from './posts';
import holdList from '../../not-on-site.txt?raw';
import { parseHolds } from './held-names';
import { projectCards, type Profile } from './profile';
import { selectedWork, type WorkCard } from './work';

/** The command Astro runs: 'dev', 'build', 'preview' or 'sync', fixed into the build by
 *  astro.config.mjs (recordCommand). Unlike NODE_ENV, no environment variable can change it. */
declare const __ASTRO_COMMAND__: string;

/** The validated profile: src/content/profile.json, through the schema in profile.ts. Pages read
 *  it here; unit tests parse the same file with the same schema. */
export async function loadProfile(): Promise<Profile> {
  const entry = await getEntry('profile', 'profile');
  if (!entry) throw new Error('src/content/profile.json did not load');
  return entry.data;
}

async function readPosts(): Promise<Post[]> {
  const [essays, notes] = await Promise.all([getCollection('writing'), getCollection('notes')]);
  return [
    ...essays.map((entry) => fromEssay(entry.id, entry.data)),
    ...notes.map((entry) => fromNote(entry.id, entry.data)),
  ];
}

const DEV = __ASTRO_COMMAND__ === 'dev';

// Every page asks (the header, the footer, the feed link), and a build's posts cannot change while
// it runs, so a build reads them once. astro dev reads them on every request, so a new post shows.
let posts: Promise<Post[]> | undefined;

/** Every essay and note, drafts included, as lib/posts.ts models them. Pages read the posts through
 *  loadWritingArea, which leaves drafts out of a production build. */
export function loadPosts(): Promise<Post[]> {
  if (DEV) return readPosts();
  posts ??= readPosts();
  return posts;
}

/** What this build writes for Writing (lib/posts.ts owns the rules). Drafts are in astro dev and in
 *  a build with DRAFTS=include, which only `pnpm build:preview` sets. */
export async function loadWritingArea(): Promise<WritingArea> {
  return writingArea(await loadPosts(), draftsIncluded(process.env, DEV));
}

/** A post's collection entry, for rendering its body. */
export async function postEntry(post: Post) {
  const entry = await getEntry(post.section, post.slug);
  if (!entry) throw new Error(`${post.section}/${post.slug}.md did not load`);
  return entry;
}

/**
 * What this build writes for the lab (lib/lab.ts): every live demo. The fixture builds
 * (scripts/build-fixtures.mjs, which names POST_FIXTURES) are Writing's test builds and hold no
 * lab: the demo meets every check over a build on dist/ and dist-preview/, the builds that hold it.
 */
export async function loadLabArea(): Promise<LabArea> {
  if (process.env['POST_FIXTURES']) return labArea([]);
  const entries = await getCollection('lab');
  return labArea(entries.map((entry) => fromLab(entry.id, entry.data)));
}

/** /about/'s entry, and whether this build writes the page (lib/about.ts). The fixture builds,
 *  Writing's test builds, hold none. */
export async function loadAbout() {
  const entry = process.env['POST_FIXTURES'] ? undefined : await getEntry('about', 'about');
  const data = entry?.data ?? null;
  return { entry, data, built: aboutBuilt(data, draftsIncluded(process.env, DEV)) };
}

/** A lab entry's collection entry, for rendering its write-up. */
export async function labEntry(entry: LabEntry) {
  const found = await getEntry('lab', entry.slug);
  if (!found) throw new Error(`lab/${entry.slug}.md did not load`);
  return found;
}

/** Selected work as this build draws it (lib/work.ts): a card per live demo in the lab, then a
 *  card per project whose check is recorded and whose hold is lifted, then a card per featured
 *  post it publishes. Home's section and the résumé's read this one list, so the two can never
 *  show different work. */
export async function loadSelectedWork(): Promise<WorkCard[]> {
  const profile = await loadProfile();
  return selectedWork(
    projectCards(profile, parseHolds(holdList)),
    await loadWritingArea(),
    await loadLabArea(),
  );
}
