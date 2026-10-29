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
          const name = `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(' ')[0]}` : ''}${pseudo ?? ''}`;
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
 *  toward its target under the pointer (ADR 0022), in document order. */
const expectedMotion = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.section-title, .card, .post-list > li')].flatMap((element) =>
      element.classList.contains('section-title')
        ? ['h2.section-title::before']
        : element.classList.contains('card')
          ? [
              'article.card::before',
              'h3.card-title',
              ...(element.querySelector('.card-more > span') ? ['span'] : []),
            ]
          : ['li::before', 'span.title-words'],
    ),
  );

test('known answer: with no preference, the same scan finds the card bar and the rising titles, and nothing else', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
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
  const title = await page.evaluate(() => {
    const element = document.querySelector('.card-title') as HTMLElement;
    const [animation] = element.getAnimations();
    return {
      scroll: animation?.timeline instanceof ViewTimeline,
      onScreen: element.getBoundingClientRect().bottom < innerHeight,
      transform: getComputedStyle(element).transform,
      progress: animation?.effect?.getComputedTiming().progress,
    };
  });
  expect(title.scroll).toBe(true);
  // At 1440 × 900 the first card's title is on the first screen, so it is already in place.
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
