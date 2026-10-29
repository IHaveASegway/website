import { expect, test, type Page } from '@playwright/test';

// Reduced motion (design-system.md, "Motion"): under prefers-reduced-motion: reduce nothing moves.
// The state still changes (the card's bar appears at once); only the movement is gone.
//
// The check reads the computed motion of every element and pseudo-element rather than waiting
// for a transition to run: whether a busy machine gets a 220 ms transition started in time is a
// race, while what the page would animate is a fact the cascade states. Then, as the design
// system asks, document.getAnimations() must be empty after load, a hover and every Tab.

/** Every element or pseudo-element that would move: a transition longer than 0s, or an animation. */
function moving(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const moves = (style: CSSStyleDeclaration) =>
      style.transitionDuration.split(',').some((d) => parseFloat(d) > 0) ||
      style.animationName.split(',').some((n) => n.trim() !== 'none');
    for (const element of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        if (moves(getComputedStyle(element, pseudo))) {
          // getAttribute, not className, which an SVG element holds as an object.
          const first = element.getAttribute('class')?.split(' ')[0];
          const name = `${element.tagName.toLowerCase()}${first ? `.${first}` : ''}${pseudo ?? ''}`;
          found.push(name);
        }
      }
    }
    return found;
  });
}

const running = (page: Page) => page.evaluate(() => document.getAnimations().length);

/** The card bar's transform: scaleX(0) while hidden, the identity matrix while shown. */
const bar = (page: Page) =>
  page.evaluate(
    () => getComputedStyle(document.querySelector('.card') as Element, '::before').transform,
  );
const SHOWN = 'matrix(1, 0, 0, 1, 0, 0)';

/** Gives the first card a link, as a card that leads somewhere has: the bar is its sign. */
const linkFirstCard = (page: Page) =>
  page.evaluate(() =>
    document
      .querySelector('.card')
      ?.insertAdjacentHTML('beforeend', '<a class="card-more" href="#main">Read more</a>'),
  );

/**
 * Puts a card with nothing to activate first in <main>, styled by the site's own stylesheet. Home
 * renders a card only when the page it opens exists (lib/work.ts), and every rendered card has a
 * link, so on a Home with no card, or to see a card without a link, the test brings its own.
 */
const addCard = (page: Page) =>
  page.evaluate(() =>
    document
      .querySelector('main')
      ?.insertAdjacentHTML(
        'afterbegin',
        '<article class="card"><p class="card-tag label">Tag</p><h3 class="card-title">A card</h3><p class="card-text">Text.</p></article>',
      ),
  );

/** How many cards the page as served renders. */
const cardCount = (page: Page) => page.locator('.card').count();

test('under reduce nothing would move, and nothing runs after a hover or any Tab', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await moving(page)).toEqual([]);
  expect(await running(page)).toBe(0);

  const controls = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('a[href], button')].filter((e) =>
        e.checkVisibility(),
      ).length,
  );
  for (let i = 0; i < controls; i++) {
    await page.keyboard.press('Tab');
    expect(await running(page), `after Tab ${i + 1}`).toBe(0);
  }

  // The state change survives without the movement: on a card with a link, the bar is drawn at
  // once on hover.
  if ((await cardCount(page)) === 0) await addCard(page);
  await linkFirstCard(page);
  await page.hover('.card');
  expect(await running(page)).toBe(0);
  expect(await bar(page)).toBe(SHOWN);
});

test('a card with nothing to activate does not react to the pointer; one with a link does', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // states, not movement, are compared here
  await page.goto('/');
  await addCard(page);
  const card = page.locator('.card').first();
  const border = () => card.evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(await card.locator('a, button').count()).toBe(0);
  const atRest = { bar: await bar(page), border: await border() };
  await card.hover();
  expect({ bar: await bar(page), border: await border() }).toEqual(atRest);

  await linkFirstCard(page);
  await page.mouse.move(0, 0);
  await card.hover();
  expect(await bar(page)).toBe(SHOWN);
  expect(await border()).not.toBe(atRest.border);
});

/** What Home would move with no preference: each section's rule, which draws itself in, each
 *  card's and post's bar, each card's title and each post's title's words, which rise as they
 *  scroll into view (design-system.md, "Motion"), and the arrow of a card's link, which steps
 *  toward its target under the pointer (ADR 0022); and since ADR 0023 each principle's title,
 *  which rises too, the first screen's picture, which tilts back as it scrolls away while its
 *  servers lift, its heartbeats while the living ground runs, and each slab of the stack, which
 *  settles as its principle arrives. In document order. */
const expectedMotion = (page: Page) =>
  page.evaluate(() => {
    const live = 'motion' in document.documentElement.dataset;
    const timelines = CSS.supports('timeline-scope: none');
    return [...document.querySelectorAll('*')].flatMap((element) => {
      if (element.matches('.section-title')) return ['h2.section-title::before'];
      if (element.matches('.card'))
        return [
          'article.card::before',
          'h3.card-title',
          ...(element.querySelector('.card-more > span') ? ['span'] : []),
        ];
      if (element.matches('.post-list > li')) return ['li::before', 'span.title-words'];
      if (element.matches('.principle-lead')) return ['span.title-words'];
      if (element.matches('svg.iso-hero')) return ['svg.iso'];
      if (element.matches('.iso-hero .iso-server')) return ['g.iso-server'];
      if (live && element.matches('.iso-hero :is(.iso-packet, .iso-ripple)'))
        return [`${element.tagName.toLowerCase()}.${element.getAttribute('class')?.split(' ')[0]}`];
      if (timelines && element.matches('.iso-slab')) return ['g.iso-slab'];
      return [];
    });
  });

test('known answer: with no preference, the same scan finds the card bar and the rising titles, and nothing else', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // The living ground starts after the first paint, and the first screen's heartbeats with it:
  // the scan reads the page once it has, or once it plainly will not.
  await page
    .waitForFunction(() => 'groundLive' in document.documentElement.dataset, null, {
      timeout: 5_000,
    })
    .catch(() => undefined);
  expect(await moving(page)).toEqual(await expectedMotion(page));
  // So the scan is shown to find motion where there is some, on the site's own stylesheet.
  await addCard(page);
  expect(await moving(page)).toEqual(await expectedMotion(page));
});

test('with no preference, a title rises on a scroll timeline, and one on screen at load stands still', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  if ((await cardCount(page)) === 0) await addCard(page);
  // A declaration the browser refused would leave no animation at all: the build's minifier once
  // folded the longhands into a shorthand Chromium refuses, and every check above still passed.
  // The first rising title: a principle's since ADR 0023, at the foot of the first screen.
  const title = await page.evaluate(() => {
    const element = document.querySelector(':is(.card-title, .title-words)') as HTMLElement;
    const [animation] = element.getAnimations();
    return {
      scroll: animation?.timeline instanceof ViewTimeline,
      onScreen: element.getBoundingClientRect().bottom < innerHeight,
      transform: getComputedStyle(element).transform,
      progress: animation?.effect?.getComputedTiming().progress,
    };
  });
  expect(title.scroll).toBe(true);
  // At 1440 × 900 the first rising title is on the first screen, so it is already in place.
  expect(title.onScreen).toBe(true);
  expect(title.progress).toBe(1);
  expect(title.transform).toBe(SHOWN);
});

/** A card's tag as drawn, and as assistive technology reads it. */
const tag = (page: Page) =>
  page.evaluate(() => {
    const element = document.querySelector('.card:has(.card-more) .card-tag') as HTMLElement;
    const shown = element.querySelector('[aria-hidden="true"]');
    return {
      drawn: (shown ?? element).textContent?.trim() ?? '',
      read: element.querySelector('[data-word]')?.textContent ?? element.textContent?.trim() ?? '',
      width: element.getBoundingClientRect().width,
    };
  });

test('with no preference, a hovered card decodes its tag and settles on the word, at one width', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  test.skip((await page.locator('.card:has(.card-more)').count()) === 0, 'Home renders no card');
  const before = await tag(page);
  const card = page.locator('.card:has(.card-more)').first();
  await card.hover();
  await page.waitForTimeout(90);
  const during = await tag(page);
  expect(during.read).toBe(before.drawn);
  expect(during.drawn).toHaveLength(before.drawn.length);
  expect(during.width).toBe(before.width);
  // Within the decode's 360 ms and a frame or two, the word is back.
  await expect.poll(async () => (await tag(page)).drawn, { timeout: 1_000 }).toBe(before.drawn);
  expect((await tag(page)).width).toBe(before.width);
});

test('under reduce, a hovered or focused card keeps its tag as it is', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  test.skip((await page.locator('.card:has(.card-more)').count()) === 0, 'Home renders no card');
  const html = () => page.locator('.card:has(.card-more) .card-tag').first().innerHTML();
  const before = await html();
  await page.locator('.card:has(.card-more)').first().hover();
  await page.locator('.card:has(.card-more) .card-more').first().focus();
  await page.waitForTimeout(120);
  expect(await html()).toBe(before);
});

test('with no preference, the followed title takes the page title’s name as Home is left, and the next page’s title has it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const link = page.locator('.card .card-more[href^="/"]').first();
  test.skip((await link.count()) === 0, 'Home renders no card that opens a page here');
  // Registered after the motion module's own listener, so it sees what that listener set.
  await page.evaluate(() =>
    addEventListener('pageswap', (event) => {
      const names = [...document.querySelectorAll<HTMLElement>('.card-title, .page-title')]
        .map((element) => getComputedStyle(element).viewTransitionName)
        .filter((name) => name !== 'none');
      sessionStorage.setItem(
        'swap',
        JSON.stringify({ transition: Boolean(event.viewTransition), names }),
      );
    }),
  );
  const title = await link.evaluate((a) =>
    a.closest('.card')?.querySelector('.card-title')?.textContent?.trim(),
  );
  await link.click();
  await page.waitForURL((url) => url.pathname !== '/');
  const swap = JSON.parse((await page.evaluate(() => sessionStorage.getItem('swap'))) ?? '{}');
  expect(swap.transition).toBe(true);
  // One name on the page being left, on the followed card's title.
  expect(swap.names).toEqual(['page-title']);
  const next = await page.locator('h1').evaluate((h1) => ({
    name: getComputedStyle(h1).viewTransitionName,
    text: h1.textContent?.trim(),
  }));
  expect(next.name).toBe('page-title');
  expect(title).toBeTruthy();
});
