import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseHolds } from '../src/lib/held-names';
import {
  ADOPTION_WORDS,
  FACT_TERMS,
  HANDLE,
  locationLine,
  profileSchema,
  projectCards,
  projectFixturePath,
  withFixture,
  type Profile,
} from '../src/lib/profile';
import { app, profile } from './support/dist';

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

// Owned work as cards (content.md, "Owned work"). Each case is a known answer on a fixture, so
// nothing here depends on which project is checked today.
const sha = 'b'.repeat(40);
const checked = { date: '2026-10-23', sha };
const project = (over: Partial<Profile['projects'][number]>): Profile['projects'][number] => ({
  name: 'a-project',
  description: 'Does one thing well.',
  url: `https://github.com/${HANDLE}/a-project`,
  ...over,
});
/** The valid profile with only these projects, and the GitHub profile checked unless told not. */
const withOnly = (projects: Profile['projects'], github = true): Profile => ({
  ...valid,
  basics: {
    ...valid.basics,
    profiles: valid.basics.profiles.map((r) =>
      r.network === 'GitHub' && github ? { ...r, checked } : r,
    ),
  },
  projects,
});
const testHolds = parseHolds('held|name  any  a test hold\n');
const realHolds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));

test("a project card renders only when its check and the GitHub profile's are recorded, and nothing on it is held", () => {
  expect(projectCards(withOnly([project({})]), testHolds)).toEqual([]);
  // The repository's page links the account, so the account's own check comes first.
  expect(projectCards(withOnly([project({ checked })], false), testHolds)).toEqual([]);
  expect(projectCards(withOnly([project({ checked })]), testHolds)).toEqual([
    {
      title: 'a-project',
      text: 'Does one thing well.',
      facts: [],
      link: {
        href: `https://github.com/${HANDLE}/a-project`,
        label: 'Source on GitHub',
        external: true,
      },
    },
  ]);
  // A held name anywhere on the card keeps it off: its name, its line, its link, its facts.
  const held = [
    project({ checked, name: 'held-name' }),
    project({ checked, description: 'Built beside heldname.' }),
    project({ checked, url: `https://github.com/${HANDLE}/held-name` }),
    project({ checked, facts: [{ term: 'Code', value: 'Held Name inside' }] }),
  ];
  for (const p of held)
    expect(projectCards(withOnly([p]), testHolds), JSON.stringify(p)).toEqual([]);
});

test('the tag and the facts pass through, and the cards keep profile order', () => {
  const cards = projectCards(
    withOnly([
      project({ checked, name: 'first', url: `https://github.com/${HANDLE}/first`, tag: 'Go' }),
      project({ name: 'unchecked', url: `https://github.com/${HANDLE}/unchecked` }),
      project({
        checked,
        name: 'second',
        url: `https://github.com/${HANDLE}/second`,
        facts: [{ term: 'Tests', value: '181' }],
      }),
    ]),
    testHolds,
  );
  expect(cards.map((c) => [c.title, c.tag, c.facts])).toEqual([
    ['first', 'Go', []],
    ['second', undefined, [{ term: 'Tests', value: '181' }]],
  ]);
});

test("the real hold list keeps both of today's projects off, even once each is checked", () => {
  const both = profile.projects
    .filter((p) => !p.name.startsWith('fixture'))
    .map((p) => ({ ...p, checked }));
  expect(both.length).toBeGreaterThanOrEqual(2);
  expect(projectCards(withOnly(both), realHolds)).toEqual([]);
});

/** The first project changed by `over`; true when the schema refuses the result. */
const refusedCard = (over: Record<string, unknown>) =>
  refused((p) => Object.assign(first(p.projects), { measured: '2026-10-23' }, over));

test('figures use the fixed terms, at most three, and carry the day they were measured', () => {
  expect(refusedCard({ facts: [{ term: 'Tests', value: '181' }] })).toBe(false);
  for (const term of FACT_TERMS)
    expect(refusedCard({ facts: [{ term, value: '1' }] }), term).toBe(false);
  expect(refusedCard({ facts: [{ term: 'GitHub', value: '2k' }] })).toBe(true);
  expect(refusedCard({ facts: FACT_TERMS.slice(0, 4).map((term) => ({ term, value: '1' })) })).toBe(
    true,
  );
  // One age for the figures: facts without `measured` are refused, and `measured` is a date.
  expect(refused((p) => (first(p.projects)['facts'] = [{ term: 'Tests', value: '181' }]))).toBe(
    true,
  );
  expect(refusedCard({ facts: [{ term: 'Tests', value: '181' }], measured: 'today' })).toBe(true);
  expect(refusedCard({ tag: '' })).toBe(true);
  expect(refusedCard({ stars: 120 })).toBe(true);
});

test('no part of a card counts adoption: each word content.md names, in the line, the tag and a figure', () => {
  for (const word of ADOPTION_WORDS) {
    expect(refusedCard({ description: `Counted in ${word} 120.` }), `line: ${word}`).toBe(true);
    expect(refusedCard({ tag: word }), `tag: ${word}`).toBe(true);
    expect(refusedCard({ facts: [{ term: 'Code', value: `120 ${word}` }] }), `fact: ${word}`).toBe(
      true,
    );
    expect(
      refusedCard({ description: `Counted in ${word.toUpperCase()} 120.` }),
      `case: ${word}`,
    ).toBe(true);
  }
  // The phrasings a denylist of facts alone let through, each refused as a card's figure.
  for (const [term, value] of [
    ['Downloaded', '10k times'],
    ['Starred by', '500 people'],
    ['Forked', '12 times'],
    ['Installed', '300 times'],
    ['GitHub', '2k ★'],
    ['Used by', '40 repositories'],
    ['npm', '10k weekly'],
    ['Dependents', '40'],
    ['Users', '300'],
  ]) {
    expect(refusedCard({ facts: [{ term, value }] }), `${term}: ${value}`).toBe(true);
  }
  // Words that only contain one of them are not counts, and pass.
  expect(refusedCard({ description: 'Forkless, starless, a clone of nothing.' })).toBe(false);
});

test('only a fixture name selects test projects; every real build reads profile.json alone', () => {
  expect(projectFixturePath(undefined)).toBeNull();
  expect(projectFixturePath('')).toBeNull();
  expect(projectFixturePath('card')).toBe('test/fixtures/profile/card.json');
  expect(() => projectFixturePath('../../etc')).toThrow(/not a fixture/);
  const data = {
    basics: { profiles: [{ network: 'GitHub' }, { network: 'LinkedIn' }] },
    projects: [{ name: 'x' }],
  };
  expect(withFixture(data, null)).toBe(data);
  expect(withFixture(data, { githubChecked: checked, projects: [{ name: 'y' }] })).toEqual({
    basics: { profiles: [{ network: 'GitHub', checked }, { network: 'LinkedIn' }] },
    projects: [{ name: 'x' }, { name: 'y' }],
  });
  // Nothing that builds or deploys the site sets PROFILE_FIXTURE: only the fixture script does.
  for (const file of ['package.json', '../../package.json', '../../.github/workflows/ci.yml']) {
    expect(readFileSync(join(app, file), 'utf8'), file).not.toContain('PROFILE_FIXTURE');
  }
});

test('the card fixture is valid: one made-up project, checked and held by nothing, and a GitHub check', () => {
  const extra = JSON.parse(readFileSync(join(app, 'test/fixtures/profile/card.json'), 'utf8'));
  const parsed = profileSchema.parse(withFixture(structuredClone(valid), extra));
  const cards = projectCards(parsed, realHolds);
  expect(cards.map((c) => c.title)).toEqual(['fixture-project']);
});
