import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { profileSchema } from './lib/profile';

// Content is code, validated when the site builds (ADR 0004; content.md, "Content model"). The
// profile is the first collection; the others arrive with the pages that render them.
const profile = defineCollection({
  // One JSON Resume document, under the id "profile".
  loader: file('src/content/profile.json', { parser: (text) => ({ profile: JSON.parse(text) }) }),
  schema: profileSchema,
});

export const collections = { profile };
