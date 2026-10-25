import { readFileSync } from 'node:fs';
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { essaySchema, noteSchema, postsBase } from './lib/posts';
import { profileSchema, projectFixturePath, withFixture, type ProfileFixture } from './lib/profile';

// Content is code, validated when the site builds (ADR 0004; content.md, "Content model"). The
// profile came first; essays and notes arrive with Writing (roadmap.md, PR 5). The lab and now
// collections arrive with the pages that render them. There is no work collection: owned work is a
// card on Home, generated from the profile's projects (content.md, "Owned work").

// Every real build reads src/content/profile.json alone. Only scripts/build-fixtures.mjs names
// PROFILE_FIXTURE, which adds made-up projects and a GitHub check to the real profile
// (lib/profile.ts, withFixture), so a fixture build shows a project's card before any real one does.
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

export const collections = { profile, writing, notes };
