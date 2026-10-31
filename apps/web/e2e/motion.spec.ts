import { expect, test, type Page } from '@playwright/test';

// Reduced motion (design-system.md, "Motion"): under prefers-reduced-motion: reduce nothing moves.
// The state still changes (the card's sweep appears at once); only the movement is gone. With no
// preference, what moves is the list below (ADR 0025): Home's scene and the board's day with it,
// once the board is seen; the 2 px sweep along a row that leads somewhere, and on the board the
// other lines dimming; and the followed title's handoff to the next page. Text never animates: no
// title rises, no rule draws itself, no tag decodes, no arrow nudges.
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

/** The card sweep's transform, on the card the test brought or else the page's first: scaleX(0)
 *  while hidden, the identity matrix while shown. */
const bar = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-test-card]') ?? document.querySelector('.card');
    return getComputedStyle(card as Element, '::before').transform;
  });
const SHOWN = 'matrix(1, 0, 0, 1, 0, 0)';

/** Gives that card a link, as a card that leads somewhere has: the bar is its sign. */
const linkFirstCard = (page: Page) =>
  page.evaluate(() =>
    (
      document.querySelector('[data-test-card]') ?? document.querySelector('.card')
    )?.insertAdjacentHTML('beforeend', '<a class="card-more" href="#main">Read more</a>'),
  );

/**
 * Puts a card with nothing to activate last in <main>, styled by the site's own stylesheet. Home
 * renders a card only when the page it opens exists (lib/work.ts), and every rendered card has a
 * link, so on a Home with no card, or to see a card without a link, the test brings its own. Last,
 * not first: Home's stage stands over the top of <main> beside the rail (ADR 0024).
 */
const addCard = (page: Page) =>
  page.evaluate(() =>
    document
      .querySelector('main')
      ?.insertAdjacentHTML(
        'beforeend',
        '<article class="card" data-test-card><h3 class="card-title">A card</h3><p class="card-text">Text.</p></article>',
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

  // The state change survives without the movement: on a card with a link, the sweep is drawn at
  // once on hover.
  if ((await cardCount(page)) === 0) await addCard(page);
  await linkFirstCard(page);
  await page.hover('.card');
  expect(await running(page)).toBe(0);
  expect(await bar(page)).toBe(SHOWN);
});

// A card has no rule of its own (ADR 0025): its one sign under the pointer is the sweep.
test('a card with nothing to activate does not react to the pointer; one with a link does', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // states, not movement, are compared here
  await page.goto('/');
  await addCard(page);
  const card = page.locator('[data-test-card]');
  expect(await card.locator('a, button').count()).toBe(0);
  const atRest = await bar(page);
  expect(atRest).not.toBe(SHOWN);
  await card.hover();
  expect(await bar(page)).toBe(atRest);

  await linkFirstCard(page);
  await page.mouse.move(0, 0);
  await card.hover();
  expect(await bar(page)).toBe(SHOWN);
});

/** What Home would move with no preference (ADR 0025): each card's and post's sweep; each band of
 *  the board, its sweep and its line, which dims while another is pointed at; and, while Home's
 *  scene runs and once the board has been seen, the board's day: each van's clock and the lamps
 *  that come up. Until ADR 0025 the scan also found the Raft Lab's election, each section's
 *  self-drawing rule, the rising titles, a card link's nudging arrow and the closing address's
 *  arrow. In document order. */
const expectedMotion = (page: Page) =>
  page.evaluate(() => {
    const live = 'motion' in document.documentElement.dataset;
    const seen = live && document.querySelector('[data-board][data-seen]') !== null;
    return [...document.querySelectorAll('*')].flatMap((element) => {
      if (element.matches('.card')) return ['article.card::before'];
      if (element.matches('.post-list > li')) return ['li::before'];
      if (element.matches('.board-lines > .band')) return ['li.band::before'];
      if (element.matches('.band > .line')) return ['div.line'];
      if (
        seen &&
        element.matches(
          '.line-routes :is(.line-van, .line-lamp-lit[data-lit], .line-van-at[data-here])',
        )
      )
        return [`${element.tagName.toLowerCase()}.${element.getAttribute('class')?.split(' ')[0]}`];
      return [];
    });
  });

test('known answer: with no preference, the same scan finds the sweeps and the board’s day, and nothing else', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // The scene starts after the first paint: the scan reads the page once it has, or once it
  // plainly will not, with the board unseen and still.
  await page
    .waitForFunction(() => 'sceneLive' in document.documentElement.dataset, null, {
      timeout: 5_000,
    })
    .catch(() => undefined);
  expect(await moving(page)).toEqual(await expectedMotion(page));
  // So the scan is shown to find motion where there is some, on the site's own stylesheet.
  await addCard(page);
  expect(await moving(page)).toEqual(await expectedMotion(page));
  // Seen, the board's day runs too: its vans' clocks and the lamps that come up, and nothing else.
  const board = page.locator('[data-board]');
  test.skip((await board.count()) === 0, 'Home has no board here');
  await board.scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.dataset['motion'] === 'on'))
    await expect(board).toHaveAttribute('data-seen', '');
  expect(await moving(page)).toEqual(await expectedMotion(page));
});

// Text never animates (ADR 0025): a card's words are the same under the pointer and the keyboard
// as at rest, with motion allowed. Until then a hovered card's tag cycled through letters.
test('with no preference, a hovered or focused row keeps its words as they are', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const rows = page.locator(':is(.card:has(.card-more), .band)');
  test.skip((await rows.count()) === 0, 'Home renders no card and no board');
  const row = rows.first();
  const words = () => row.evaluate((element) => element.textContent);
  const before = await words();
  await row.hover();
  await page.waitForTimeout(90);
  expect(await words()).toBe(before);
  await row.locator(':is(.card-more, .band-title)').focus();
  await page.waitForTimeout(120);
  expect(await words()).toBe(before);
});

test('with no preference, the followed title takes the page title’s name as Home is left, and the next page’s title has it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // A band of the board, whose title is its link (ADR 0025), or else a card that opens a page here.
  const link = page.locator(':is(.band-title, .card .card-more)[href^="/"]').first();
  test.skip((await link.count()) === 0, 'Home renders no row that opens a page here');
  // Registered after the motion module's own listener, so it sees what that listener set.
  await page.evaluate(() =>
    addEventListener('pageswap', (event) => {
      const names = [
        ...document.querySelectorAll<HTMLElement>('.card-title, .band-title, .page-title'),
      ]
        .map((element) => getComputedStyle(element).viewTransitionName)
        .filter((name) => name !== 'none');
      sessionStorage.setItem(
        'swap',
        JSON.stringify({ transition: Boolean(event.viewTransition), names }),
      );
    }),
  );
  const title = await link.evaluate((a) =>
    (a.matches('.band-title')
      ? a
      : a.closest('.card')?.querySelector('.card-title')
    )?.textContent?.trim(),
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
