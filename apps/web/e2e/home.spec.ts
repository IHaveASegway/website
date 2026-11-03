import { expect, test, type Page } from '@playwright/test';
import { pages } from './expected';

// Home (docs/design/home.md; ADR 0028, ADR 0031): Joseph's words at the size of a statement; beside
// them the one live thing on the page, the Raft Lab's cluster as its page opens; the things to try,
// each with the lab where it breaks and one fact from its build; the dated writing; the last thing
// built; and where to reach out. Until
// ADR 0028 Home drew the five labs as one isometric system beside named bio blocks, with a stats row
// and an activity calendar, in the layout of a page Joseph had named as a reference: what the
// checks held for that drawing, that it moves only as asked, pauses on request (SC 2.2.2), holds
// still under reduced motion and shifts nothing, they hold for the cluster.

const picture = (page: Page) => page.locator('figure.orbit');
const toggle = (page: Page) => page.locator('[data-motion-toggle]');

/** The running animations inside the picture, by their state; the scroll's tilt is the reader's. */
const animationStates = (page: Page) =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('figure.orbit *')].flatMap((element) =>
        element
          .getAnimations()
          .filter((a) => !(a.timeline && 'source' in a.timeline))
          .map((a) => a.playState),
      ),
    ),
  ]);

test.describe("Home's opening", () => {
  for (const width of [320, 390, 1440]) {
    test(`at ${width} px the role, then the name in its own case, the statement and both ways to reach him`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const name = page.locator('h1#name');
      await expect(name).toHaveText('Joseph Peterson');
      await expect(name).toHaveCSS('text-transform', 'none');
      const role = await page.locator('.hero-role').boundingBox();
      const named = await name.boundingBox();
      expect((role?.y ?? 0) + (role?.height ?? 0)).toBeLessThanOrEqual(named?.y ?? 0);
      // One line on a phone from 390 px; beside the cluster on a wide screen it stands in two.
      const lines = await name.evaluate((h) =>
        Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)),
      );
      expect(lines, 'lines of the name').toBe(2);
      expect(lines).toBeLessThanOrEqual(2);
      await expect(page.locator('.hero-actions .btn-email')).toHaveAttribute(
        'href',
        'mailto:hello@ihaveasegway.com',
      );
      await expect(page.locator('.hero-actions .btn').last()).toHaveText('LinkedIn');
    });
  }

  // What Joseph does, and what the page is for (ADR 0031). The second sentence is Home's own, and the
  // first is the bio's, so it's the one /about/ opens with. Until 2026-11-03 the statement linked its
  // kinds of system to their labs.
  test("the statement says the bio's first sentence, then what the page is for, with no link", async ({
    page,
  }) => {
    await page.goto('/');
    const statement = page.locator('.hero-statement');
    test.skip((await statement.count()) === 0, 'this build has no bio');
    await expect(statement).toHaveText(
      'I take an idea and build the entire system. Here are a few things you can break.',
    );
    await expect(statement.locator('a')).toHaveCount(0);
    await page.goto('/about/');
    await expect(page.locator('.bio-lede')).toContainText(
      'I take an idea and build the entire system.',
    );
    await expect(page.locator('.bio-lede')).not.toContainText('things you can break');
  });
});

/** Through the ring's whole turn, seeked a step at a time: how many steps cut a server or a bead of
 *  its log at the clip's edge, and by how much at worst, in px. Until 2026-11-02 they were cut for
 *  half of every turn, 12 px at the bottom at 1440 px, right under a caption that says the servers
 *  keep the same log. */
const cutThroughTheTurn = (page: Page) =>
  page.evaluate(() => {
    const turn = document
      .getAnimations()
      .find((a) => (a as CSSAnimation).animationName === 'orbit-turn');
    if (!turn) throw new Error('the ring is not turning');
    turn.pause();
    const clip = (document.querySelector('.orbit-clip') as Element).getBoundingClientRect();
    const STEPS = 180;
    let steps = 0;
    let worst = 0;
    for (let step = 0; step < STEPS; step++) {
      turn.currentTime = (step / STEPS) * 90_000;
      let cut = 0;
      for (const mark of document.querySelectorAll('.orbit-entry, .orbit-node')) {
        const box = mark.getBoundingClientRect();
        cut = Math.max(
          cut,
          clip.left - box.left,
          clip.top - box.top,
          box.right - clip.right,
          box.bottom - clip.bottom,
        );
      }
      if (cut > 0.5) steps += 1;
      worst = Math.max(worst, cut);
    }
    return { steps, worst };
  });

test.describe("Home's live picture", () => {
  for (const [width, height] of [
    [320, 568],
    [390, 664],
    [768, 900],
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [2560, 1440],
  ] as const) {
    test(`at ${width} px no server or bead is cut as the ring turns, and the ring keeps its size`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width, height });
      await page.goto('/');
      test.skip((await picture(page).count()) === 0, 'this build writes no Raft Lab');
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
      expect(await cutThroughTheTurn(page)).toEqual({ steps: 0, worst: expect.any(Number) });
      // The room came from the margin, not from the ring: it still fills its column, up to 36rem.
      const sizes = await page.evaluate(() => ({
        plane: (document.querySelector('.orbit-plane') as HTMLElement).offsetWidth,
        stage: (document.querySelector('.orbit-stage') as HTMLElement).offsetWidth,
        page: document.documentElement.scrollWidth,
      }));
      expect(sizes.plane).toBe(Math.min(sizes.stage, 576));
      expect(sizes.page).toBe(width);
    });
  }

  // The known answer: the same reading on the stage as it stood, the clip on its own edges and the
  // plane at its middle, finds what the turn cut.
  test('known answer: with the clip on the stage and the ring at its middle, the cut is found', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    test.skip((await picture(page).count()) === 0, 'this build writes no Raft Lab');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await page.evaluate(() => {
      const old = new CSSStyleSheet();
      old.replaceSync(`.orbit-clip { inset-inline: 0; }
        .orbit-plane { inset-block-start: 50%; inline-size: min(100%, 36rem); }`);
      document.adoptedStyleSheets = [old];
    });
    const { steps, worst } = await cutThroughTheTurn(page);
    expect(steps).toBeGreaterThan(50);
    expect(worst).toBeGreaterThan(8);
  });

  test("it is the Raft Lab's cluster as its page opens: one leader lit, every log as long, a link to break it", async ({
    page,
  }) => {
    await page.goto('/');
    test.skip((await picture(page).count()) === 0, 'this build writes no Raft Lab');
    const servers = picture(page).locator('.orbit-server');
    await expect(servers).toHaveCount(5);
    await expect(picture(page).locator('.orbit-leader')).toHaveCount(1);
    const logs = await servers.evaluateAll((all) =>
      all.map((server) => server.querySelectorAll('.orbit-entry').length),
    );
    expect(new Set(logs).size, `logs ${logs.join(', ')}`).toBe(1);
    expect(logs[0]).toBeGreaterThan(0);
    await expect(picture(page).locator('figcaption')).toHaveText(
      /^A simulation of five servers keeping the same log, the ordered list of every write\. Server \d is the leader in this picture, and its heartbeats tell the other four it’s up, so they keep following it\. Try to break it in the Raft Lab$/,
    );
    await expect(picture(page).locator('figcaption a')).toHaveAttribute('href', '/lab/raft/');
  });

  test('it runs once the page has painted, pauses and plays from the bar, and the choice lasts the tab', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    test.skip((await picture(page).count()) === 0, 'this build writes no Raft Lab');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    expect(await animationStates(page)).toEqual(['running']);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    expect(await animationStates(page)).toEqual(['paused']);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    expect(await animationStates(page)).toEqual(['running']);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();
  });

  test('under reduced motion it is a still picture: nothing runs, and there is no button', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).not.toHaveAttribute('data-motion');
    await expect(page.locator('.motion-item')).toBeHidden();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('it shifts nothing as it loads and runs, and its box is the same with and without its motion', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shifts: number };
      w.shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[])
          w.shifts += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    test.skip((await picture(page).count()) === 0, 'this build writes no Raft Lab');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBe(0);
    const running = await picture(page).boundingBox();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    expect(await picture(page).boundingBox()).toEqual(running);
  });

  // Every page holds the button, since the field behind every page runs by itself (ADR 0030).
  test('no other page has the picture, and every page has the motion button', async ({ page }) => {
    for (const path of pages().filter((p) => p !== '/')) {
      await page.goto(path);
      await expect(picture(page), path).toHaveCount(0);
      await expect(toggle(page), path).toHaveCount(1);
    }
  });
});

// The things to try: the bio's five, in its order, each with the lab its words name, that lab's colour
// and one fact from its build (lib/lab-facts.ts). The labs the bio names are the cards' labs on the
// Lab index, so each fact here is the one a visitor finds there.
test("Things to try: the bio's five in its order, each lab's row with its fact", async ({
  page,
}) => {
  await page.goto('/about/');
  const leads = await page.locator('.bio-row[data-line] .bio-item-lead').allInnerTexts();
  expect(leads.length, "/about/'s rows").toBeGreaterThan(0);
  await page.goto('/');
  const rows = page.locator('#build .build');
  test.skip((await rows.count()) === 0, 'this build has no bio');
  expect(await rows.locator('.build-lead').allInnerTexts()).toEqual(leads);
  for (const row of await rows.all()) {
    const line = await row.getAttribute('data-line');
    if (!line) continue;
    await expect(row.locator(`.build-text a[href="/lab/${line}/"]`)).toHaveCount(1);
    // Home names the made-up bakery nowhere else, so the line over a fact says what it is about.
    await expect(row.locator('.build-lab')).toHaveText(
      line === 'raft' || line === 'routes'
        ? /^Simulated in the \w+ Lab$/
        : /^Simulated in the \w+ Lab, with a made-up bakery’s (orders|menu|report)$/,
    );
    await expect(row.locator('.build-fact')).toHaveText(/\S.*\.$/);
  }
});

// Home's rows are /writing/'s list (components/PostList.astro), so a post's day, kind and reading
// time read the same on both. Until the overhaul's merge Home drew its own rows and counted 230
// words a minute while /writing/ counted 220, and one post could read "6 min" on one page and
// "7 min" on the other.
test("Home's writing rows: the day, the title as the row's link, its summary, its kind and reading time, as /writing/ says them", async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('#writing .post-row');
  test.skip((await rows.count()) === 0, 'this build lists no post');
  const home = new Map<string, string>();
  for (const row of await rows.all()) {
    await expect(row.locator('.post-date time')).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    const link = row.locator('.post-title a');
    await expect(link).toHaveAttribute('href', /^\/(writing|notes)\/.+\/$/);
    await expect(row.locator('.post-summary')).not.toBeEmpty();
    await expect(row.locator('.post-kind')).toHaveText(/\d+ min read$/);
    home.set((await link.getAttribute('href')) ?? '', (await row.innerText()).trim());
  }
  for (const section of new Set([...home.keys()].map((href) => href.split('/')[1]))) {
    await page.goto(`/${section}/`);
    for (const row of await page.locator('main .post-row').all()) {
      const href = (await row.locator('.post-title a').getAttribute('href')) ?? '';
      if (home.has(href)) expect((await row.innerText()).trim(), href).toBe(home.get(href));
    }
  }
});

// The address works with no mail app (components/home/Contact.astro; scripts/copy.js): pressed, the
// button copies it, or where the clipboard refuses (a page not served securely) selects it, says
// which, and keeps its width, so nothing moves.
// "made-up" is one word to read: the line over a fact must not split it at its hyphen. Phones, and the
// widths from 1,024 to 1,112 px where the third column split it until 2026-11-03: four widths saw none.
test('at every width the line over a fact keeps "made-up" whole', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 360, 390, 430, 1024, 1040, 1056, 1072, 1088, 1104, 1112]) {
    await page.setViewportSize({ width, height: 844 });
    const lines = await page.locator('.build-lab').evaluateAll((labels) =>
      labels.flatMap((label) => {
        const word = [...label.querySelectorAll('span')].find(
          (span) => span.textContent === 'made-up',
        );
        return word ? [new Set([...word.getClientRects()].map((r) => Math.round(r.top))).size] : [];
      }),
    );
    expect(lines, `at ${width} px`).toEqual([1, 1, 1]);
  }
});

test('Home closes with the address, a button that copies it without moving, and LinkedIn', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await page.goto('/');
  const contact = page.locator('#contact');
  await expect(contact.locator('.contact-address')).toHaveAttribute(
    'href',
    'mailto:hello@ihaveasegway.com',
  );
  await expect(contact.locator('.contact-address')).toHaveText('hello@ihaveasegway.com');
  const copy = contact.locator('.btn-copy');
  await expect(copy).toHaveText('Copy email address');
  await copy.scrollIntoViewIfNeeded();
  const size = async () => {
    const box = await copy.boundingBox();
    return { width: box?.width, height: box?.height };
  };
  const before = await size();
  await copy.click();
  const secure = await page.evaluate(() => isSecureContext && 'clipboard' in navigator);
  if (secure) {
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'hello@ihaveasegway.com',
    );
  } else {
    await expect(copy).toHaveText('Selected above');
    expect(await page.evaluate(() => getSelection()?.toString().replace(/\s/g, ''))).toBe(
      'hello@ihaveasegway.com',
    );
  }
  expect(await size()).toEqual(before);
  await expect(copy).toHaveText('Copy email address', { timeout: 5_000 });
  await expect(contact.locator('a.btn')).toHaveText(['LinkedIn']);
});
