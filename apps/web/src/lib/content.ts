import { getCollection, getEntry } from 'astro:content';
import {
  draftsIncluded,
  fromEssay,
  fromNote,
  writingArea,
  type Post,
  type WritingArea,
} from './posts';
import type { Profile } from './profile';

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

// Every page asks (the header, the footer, the feed link), and a build's posts cannot change while
// it runs, so a build reads them once. astro dev reads them on every request, so a new post shows.
let posts: Promise<Post[]> | undefined;

/** Every essay and note, drafts included, as lib/posts.ts models them. */
export function loadPosts(): Promise<Post[]> {
  if (import.meta.env.DEV) return readPosts();
  posts ??= readPosts();
  return posts;
}

/** What this build writes for Writing (lib/posts.ts owns the rules). Drafts are in astro dev and in
 *  a build with DRAFTS=include, which CI sets for pull requests alone. */
export async function loadWritingArea(): Promise<WritingArea> {
  return writingArea(await loadPosts(), draftsIncluded(process.env, import.meta.env.DEV));
}

/** A post's collection entry, for rendering its body. */
export async function postEntry(post: Post) {
  const entry = await getEntry(post.section, post.slug);
  if (!entry) throw new Error(`${post.section}/${post.slug}.md did not load`);
  return entry;
}
