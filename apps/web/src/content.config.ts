import { readFileSync } from 'node:fs';
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { labSchema } from './lib/lab';
import { essaySchema, noteSchema, postsBase } from './lib/posts';
import { profileSchema, projectFixturePath, withFixture, type ProfileFixture } from './lib/profile';

// Content is code, validated when the site builds (ADR 0004; content.md, "Content model"). The
// profile came first; essays and notes arrive with Writing (roadmap.md, PR 5), and the lab with its
// first demo (ADR 0016). The now collection arrives with the page that renders it. There is no work collection: owned work is a
// card on Home, generated from the profile's projects (content.md, "Owned work").

// Every real build reads src/content/profile.json alone. Only scripts/build-fixtures.mjs names
// PROFILE_FIXTURE, which adds made-up projects, roles and skills and a GitHub check to the real
// profile (lib/profile.ts, withFixture), so a fixture build shows a project's card, and the
// résumé's roles and skills, before any real one does.
const fixturePath = projectFixturePath(process.env['PROFILE_FIXTURE']);
const fixture: ProfileFixture | null = fixturePath
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : null;

const profile = defineCollection({
  // One JSON Resume document, under the id "profile".
  loader: file('src/content/profile.json', {
    parser: (text) => ({ profile: withFixture(JSON.parse(text), fixture) }),
  }),
  schema: profileSchema,
});

// src/content in every real build. Only scripts/build-fixtures.mjs points here at test fixtures,
// and test/writing.test.ts fails if a fixture ever reaches dist/ (lib/posts.ts, postsBase).
const posts = postsBase(process.env['POST_FIXTURES']);

// The slug is the file name, exactly: glob()'s default would slugify it, so "My Post.md" would
// publish quietly as /writing/my-post/. Here a bad name stays bad, and the URL checks refuse it.
const fileName = ({ entry }: { entry: string }) => entry.replace(/\.md$/, '');

// Markdown only, for now. MDX joins with the first post that needs one of its shared components
// (content.md, "MDX stays thin"), and with it @astrojs/mdx.
const writing = defineCollection({
  loader: glob({ base: `${posts}/writing`, pattern: '*.md', generateId: fileName }),
  schema: essaySchema,
});

const notes = defineCollection({
  loader: glob({ base: `${posts}/notes`, pattern: '*.md', generateId: fileName }),
  schema: noteSchema,
});

// One entry per demo: its front matter and its write-up. The fixture builds read the same folder,
// and lib/content.ts leaves the lab out of them (loadLabArea).
const lab = defineCollection({
  loader: glob({ base: './src/content/lab', pattern: '*.md', generateId: fileName }),
  schema: labSchema,
});

export const collections = { profile, writing, notes, lab };
