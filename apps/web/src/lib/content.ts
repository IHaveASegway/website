import { getEntry } from 'astro:content';
import type { Profile } from './profile';

/** The validated profile: src/content/profile.json, through the schema in profile.ts. Pages read
 *  it here; unit tests parse the same file with the same schema. */
export async function loadProfile(): Promise<Profile> {
  const entry = await getEntry('profile', 'profile');
  if (!entry) throw new Error('src/content/profile.json did not load');
  return entry.data;
}
