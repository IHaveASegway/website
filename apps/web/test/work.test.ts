import { describe, expect, test } from 'vitest';
import { writingArea, type Post } from '../src/lib/posts';
import type { ProjectCard } from '../src/lib/profile';
import {
  FEATURED_POSTS,
  postCards,
  selectedWork,
  withTargets,
  writingRow,
  type FeaturedPost,
  type WorkCard,
} from '../src/lib/work';

// lib/work.ts with known answers: a card renders only when the page it opens exists. A featured
// post gets a card once it is published in the build, never while it is a draft or before it
// exists, and any card whose link names no target this build vouches for is dropped, whatever
// made it. test/project-cards.test.ts holds every build's Home to the same rule.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
function post(slug: string, over: Partial<Post> = {}): Post {
  return {
    section: 'writing',
    slug,
    title: `Title ${slug}`,
    summary: `Summary ${slug}`,
    published: day('2026-10-20'),
    updated: null,
    draft: false,
    tags: [],
    kind: 'essay',
    source: null,
    ...over,
  };
}

const teardown: FeaturedPost = {
  section: 'writing',
  slug: 'trading-bot-teardown',
  label: 'Read the teardown',
};
const project: ProjectCard = {
  title: 'a-project',
  text: 'A project.',
  facts: [{ term: 'Tests', value: '12' }],
  link: {
    href: 'https://github.com/IHaveASegway/a-project',
    label: 'Source on GitHub',
    external: true,
  },
};
const card = (href: string, external = false): WorkCard => ({
  title: href,
  text: 'x',
  facts: [],
  link: { href, label: 'Open', external },
});

describe('the featured posts', () => {
  test('the auto-trader teardown is featured, on this site under /writing/, never on GitHub', () => {
    expect(FEATURED_POSTS).toEqual([teardown]);
  });
});

describe('postCards: a card per featured post that is published', () => {
  test('a published post gets a card in its own words: its title, summary and kind, linking to its page', () => {
    const published = [
      post('trading-bot-teardown', {
        title: 'What the trading bot taught me',
        summary: 'A postmortem.',
        kind: 'postmortem',
      }),
    ];
    expect(postCards([teardown], published)).toEqual([
      {
        title: 'What the trading bot taught me',
        text: 'A postmortem.',
        tag: 'Postmortem',
        facts: [],
        link: {
          href: '/writing/trading-bot-teardown/',
          label: 'Read the teardown',
          external: false,
        },
      },
    ]);
  });

  test('a draft, a post not written yet, or one in the other section gets none', () => {
    expect(postCards([teardown], [post('trading-bot-teardown', { draft: true })])).toEqual([]);
    expect(postCards([teardown], [post('another-post')])).toEqual([]);
    expect(postCards([teardown], [])).toEqual([]);
    expect(
      postCards([teardown], [post('trading-bot-teardown', { section: 'notes', kind: 'note' })]),
    ).toEqual([]);
  });
});

describe('withTargets: the rule every card meets', () => {
  test('a card renders only when the page its link opens is a target this build has', () => {
    const cards = [
      card('/writing/a/'),
      card('/writing/missing/'),
      card('https://example.com/', true),
    ];
    expect(withTargets(cards, new Set(['/writing/a/'])).map((c) => c.link.href)).toEqual([
      '/writing/a/',
    ]);
    expect(withTargets(cards, new Set())).toEqual([]);
  });

  test('an external link is held to the same rule: it renders only when its target is vouched for', () => {
    const cards = [card('https://github.com/IHaveASegway/other', true)];
    expect(withTargets(cards, new Set([project.link.href]))).toEqual([]);
  });

  test('order is kept', () => {
    const cards = [card('/b/'), card('/a/')];
    expect(withTargets(cards, new Set(['/a/', '/b/'])).map((c) => c.link.href)).toEqual([
      '/b/',
      '/a/',
    ]);
  });
});

describe("selectedWork: Home's cards, from the projects and the build's posts", () => {
  const teardownPost = post('trading-bot-teardown', { kind: 'postmortem' });

  test('nothing to show: no card, so Home has no Selected work', () => {
    expect(selectedWork([], writingArea([], false))).toEqual([]);
    expect(selectedWork([], writingArea([post('other')], false))).toEqual([]);
  });

  test('the teardown, once published, gets a card after the project cards', () => {
    const cards = selectedWork([project], writingArea([post('other'), teardownPost], false));
    expect(cards.map((c) => c.link.href)).toEqual([
      'https://github.com/IHaveASegway/a-project',
      '/writing/trading-bot-teardown/',
    ]);
  });

  test('a draft teardown gets no card, even in a preview that builds its page', () => {
    const draft = post('trading-bot-teardown', { draft: true });
    expect(selectedWork([], writingArea([post('other'), draft], true))).toEqual([]);
    expect(selectedWork([], writingArea([draft], true))).toEqual([]);
  });

  test('the preview and production builds of the same posts show the same cards', () => {
    const posts = [teardownPost, post('draft', { draft: true })];
    expect(selectedWork([project], writingArea(posts, true))).toEqual(
      selectedWork([project], writingArea(posts, false)),
    );
  });
});

describe("writingRow: Home's Writing row never repeats a card", () => {
  const newest = [post('c'), post('b'), post('a'), post('older')];

  test('with no card, the three latest posts, newest first', () => {
    expect(writingRow(newest, []).map((p) => p.slug)).toEqual(['c', 'b', 'a']);
  });

  test('a post Selected work shows as a card is left out, and the next one moves up', () => {
    expect(writingRow(newest, [card('/writing/b/')]).map((p) => p.slug)).toEqual([
      'c',
      'a',
      'older',
    ]);
  });

  test('when the only post is a card, the row lists nothing', () => {
    expect(
      writingRow(
        [post('trading-bot-teardown')],
        postCards([teardown], [post('trading-bot-teardown')]),
      ),
    ).toEqual([]);
  });

  test('a project card, which links off the site, removes nothing', () => {
    expect(writingRow(newest, [card('https://github.com/IHaveASegway/c', true)])).toHaveLength(3);
  });
});
