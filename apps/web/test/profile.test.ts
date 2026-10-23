import { expect, test } from 'vitest';
import { HANDLE, locationLine, profileSchema, type Profile } from '../src/lib/profile';
import { profile } from './support/dist';

// profile.json's schema refuses what the profile must never hold (content.md, "Content model").
// Each case is a known answer: a schema that accepted it would be a rule nobody enforces.

/** profile.json as plain data a test may break on purpose. */
interface Loose {
  basics: Record<string, unknown> & {
    location: Record<string, unknown>;
    profiles: Record<string, unknown>[];
  };
  work: unknown[];
  education: unknown[];
  skills: unknown[];
  projects: Record<string, unknown>[];
}

// profile.json with both networks, a LinkedIn record under a made-up slug among them, so each
// network's rules are tested whatever profile.json holds today.
const valid: Profile = {
  ...structuredClone(profile),
  basics: {
    ...structuredClone(profile.basics),
    profiles: [
      { network: 'GitHub', url: `https://github.com/${HANDLE}` },
      { network: 'LinkedIn', url: 'https://www.linkedin.com/in/someone-example/' },
    ],
  },
};
const refused = (mutate: (p: Loose) => void) => {
  const copy = structuredClone(valid) as unknown as Loose;
  mutate(copy);
  return !profileSchema.safeParse(copy).success;
};
/** The first item, which these fixtures always have. */
function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('the fixture is empty');
  return item;
}
const byNetwork = (p: Loose, network: string) =>
  first(p.basics.profiles.filter((x) => x['network'] === network));

test('profile.json is valid, and its location line is the country, remote', () => {
  expect(profileSchema.safeParse(profile).success).toBe(true);
  expect(profileSchema.safeParse(valid).success).toBe(true);
  expect(locationLine(profile)).toBe('US · remote');
});

test('there is no slot for a region, a city, an address, an email or a phone number', () => {
  expect(refused((p) => (p.basics.location['region'] = 'somewhere'))).toBe(true);
  expect(refused((p) => (p.basics.location['city'] = 'somewhere'))).toBe(true);
  expect(refused((p) => (p.basics.location['address'] = 'somewhere'))).toBe(true);
  expect(refused((p) => (p.basics['email'] = 'someone@example.com'))).toBe(true);
  expect(refused((p) => (p.basics['phone'] = '555'))).toBe(true);
});

test('work, education and skills take no entry until their schema is cleared', () => {
  expect(
    refused((p) => p.work.push({ name: 'An employer', position: 'x', startDate: '2020' })),
  ).toBe(true);
  expect(refused((p) => p.education.push({ institution: 'A school' }))).toBe(true);
  expect(refused((p) => p.skills.push({ name: 'Go', keywords: [] }))).toBe(true);
});

test('a readiness check must be complete: a GitHub record names its commit, a date is a date', () => {
  const sha = 'a'.repeat(40);
  expect(refused((p) => (first(p.projects)['checked'] = { date: '2026-10-23' }))).toBe(true);
  expect(refused((p) => (first(p.projects)['checked'] = { date: 'today', sha }))).toBe(true);
  expect(refused((p) => (first(p.projects)['checked'] = { date: '2026-10-23', sha: 'abc' }))).toBe(
    true,
  );
  expect(refused((p) => (first(p.projects)['checked'] = { date: '2026-10-23', sha }))).toBe(false);
});

test('a LinkedIn check is a date alone, and each network takes only its own profile URL', () => {
  const linkedin = (p: Loose) => byNetwork(p, 'LinkedIn');
  const github = (p: Loose) => byNetwork(p, 'GitHub');
  expect(refused((p) => (linkedin(p)['checked'] = { date: '2026-10-23' }))).toBe(false);
  expect(
    refused((p) => (linkedin(p)['checked'] = { date: '2026-10-23', sha: 'a'.repeat(40) })),
  ).toBe(true);
  expect(refused((p) => (linkedin(p)['url'] = 'https://www.linkedin.com/company/someone/'))).toBe(
    true,
  );
  expect(refused((p) => (github(p)['url'] = 'https://github.com/someone-else'))).toBe(true);
  expect(
    refused((p) => (first(p.projects)['url'] = 'https://github.com/someone-else/stillhere')),
  ).toBe(true);
});
