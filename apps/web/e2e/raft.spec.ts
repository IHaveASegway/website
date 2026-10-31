import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Raft Lab in a browser (ADR 0020): without JavaScript the page is the opening run the build
// drew, with no control; with it, nothing moves or loads until the visitor shows intent, the
// simulation takes over at the picture's exact moment, runs only between Run and Pause, and keeps
// the five safety properties through a cut-off leader; under reduced motion it advances in
// discrete steps; and the page meets axe after a run, since script redrew it.

const RAFT = '/lab/raft/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const HELD = /^All five safety properties held over [\d,]+ events\.$/;

const clock = (page: Page) => page.locator('[data-rf-clock]');
const summary = (page: Page) => page.locator('[data-rf-summary]');
const status = (page: Page) => page.locator('[data-rf-status]');
const log = (page: Page) => page.locator('[data-rf-lines] li');

/** Collects policy violations the page reports. */
async function watch(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

/** Virtual seconds on the clock. */
const seconds = async (page: Page) =>
  Number(/([\d.]+) s/.exec((await clock(page).textContent()) ?? '')?.[1] ?? NaN);

test('without JavaScript, the page is the opening run: five nodes, three committed entries each, no control', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(RAFT);
  await expect(page.locator('[data-rf-node]')).toHaveCount(5);
  await expect(page.locator('.rf-cell[data-done]')).toHaveCount(15);
  await expect(summary(page)).toHaveText(/^Node \d leads term \d+, 3 entries committed\.$/);
  await expect(status(page)).toHaveText(HELD);
  for (const control of await page.locator('.rf-controls, .rf-clock').all())
    await expect(control).toBeHidden();
  await context.close();
});

test('nothing loads or moves before intent; Run plays, Pause stops, with no policy violation', async ({
  page,
}) => {
  const violations = await watch(page);
  const app: string[] = [];
  page.on('request', (r) => /\/_astro\/app\./.test(r.url()) && app.push(r.url()));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(RAFT);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  const opening = await seconds(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(app).toHaveLength(1);
  await expect.poll(() => seconds(page), { timeout: 5_000 }).toBeGreaterThan(opening + 0.02);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await seconds(page);
  await page.waitForTimeout(400);
  expect(await seconds(page)).toBe(paused);
  expect(await violations()).toEqual([]);
});

test('cut off the leader: a new term elects another leader, and every safety property holds', async ({
  page,
}) => {
  await page.goto(RAFT);
  const before = (await summary(page).textContent()) ?? '';
  const [, oldLeader, oldTerm] = /^Node (\d) leads term (\d+)/.exec(before) ?? [];
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  // The old leader still leads its own term on its side; the majority elects a newer one.
  await expect
    .poll(
      async () => {
        const [, leader, term] =
          /^Node (\d) leads term (\d+)/.exec((await summary(page).textContent()) ?? '') ?? [];
        return leader !== undefined && leader !== oldLeader && Number(term) > Number(oldTerm);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(status(page)).toHaveText(HELD);
  await expect(page.locator('[data-rf-lines]')).toContainText('The network splits');
});

/** How the cut's fence meets each node as drawn: its timer ring with half its stroke, and each
 *  line of text with its halo. Each node must be wholly inside the fence or wholly outside it,
 *  and never under its line. Says how many nodes are inside, or what went wrong. */
// Points sit under 1 unit apart, closer than the fence's 1.5 px line, so it cannot slip between.
const fenced = (page: Page) =>
  page.evaluate(() => {
    const cut = document.querySelector<SVGPathElement>('[data-rf-cut]');
    if (!cut || cut.hasAttribute('data-off')) return 'no fence';
    let inside = 0;
    for (const node of document.querySelectorAll<SVGGElement>('[data-rf-node]')) {
      const points: DOMPoint[] = [];
      const ring = node.querySelector<SVGCircleElement>('.rf-track');
      if (ring) {
        const [cx, cy, r] = [ring.cx, ring.cy, ring.r].map((a) => a.baseVal.value) as [
          number,
          number,
          number,
        ];
        for (let i = 0; i < 256; i++) {
          const a = (i * Math.PI) / 128;
          points.push(new DOMPoint(cx + (r + 1.5) * Math.cos(a), cy + (r + 1.5) * Math.sin(a)));
        }
      }
      for (const text of node.querySelectorAll('text')) {
        const { x, y, width, height } = text.getBBox();
        const [left, top, right, bottom] = [x - 2, y - 2, x + width + 2, y + height + 2];
        for (let t = 0; t <= 1; t += 1 / 64)
          points.push(
            new DOMPoint(left + t * (right - left), top),
            new DOMPoint(left + t * (right - left), bottom),
            new DOMPoint(left, top + t * (bottom - top)),
            new DOMPoint(right, top + t * (bottom - top)),
          );
      }
      const id = Number(node.dataset.rfNode) + 1;
      if (points.some((p) => cut.isPointInStroke(p))) return `the line crosses node ${id}`;
      const within = points.filter((p) => cut.isPointInFill(p)).length;
      if (within === points.length) inside++;
      else if (within > 0) return `node ${id} is partly inside`;
    }
    return inside;
  });

test('a cut network: a fence closes off the smaller side and crosses no node or its text', async ({
  page,
}) => {
  await page.goto(RAFT);
  await expect.poll(() => fenced(page)).toBe('no fence');
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  await expect.poll(() => fenced(page)).toBe(1);
  await page.getByRole('button', { name: 'Heal the network' }).click();
  await expect.poll(() => fenced(page)).toBe('no fence');
  await page.getByRole('button', { name: 'Split 2 and 3' }).click();
  await expect.poll(() => fenced(page)).toBe(2);
});

test('a node button crashes it and then restarts it, and says so in its name', async ({ page }) => {
  await page.goto(RAFT);
  const first = page.locator('[data-rf-toggle="0"]');
  await first.click();
  await expect(first).toHaveText('Restart node 1');
  await expect(first).toHaveAccessibleName('Restart node 1, now down');
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'false');
  await first.click();
  await expect(first).toHaveText('Crash node 1');
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'true');
});

test('under reduce, Run advances in still steps of half a second of the chosen speed, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(RAFT);
  // Every time the clock shows, as it changes: a step the test did not sample cannot hide.
  await page.locator('[data-rf-map]').hover();
  await expect(log(page)).toHaveCount(13);
  await page.evaluate(() => {
    const clock = document.querySelector('[data-rf-clock]');
    const seen: string[] = [];
    Object.defineProperty(window, '__clockSeen', { value: seen });
    if (clock)
      new MutationObserver(() => seen.push(clock.textContent ?? '')).observe(clock, {
        childList: true,
        characterData: true,
        subtree: true,
      });
  });
  /** Runs until the clock has moved a few steps, then pauses: the steps it took, in virtual ms. */
  const steps = async () => {
    const from = await clock(page).textContent();
    await page.evaluate(() => {
      (window as unknown as { __clockSeen: string[] }).__clockSeen.length = 0;
    });
    const before = await seconds(page);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect.poll(() => seconds(page), { timeout: 3_000 }).toBeGreaterThan(before + 0.06);
    await page.getByRole('button', { name: 'Pause' }).click();
    const seen = await page.evaluate(
      () => (window as unknown as { __clockSeen: string[] }).__clockSeen,
    );
    const ms = [from, ...seen].map((text) =>
      Math.round(Number(/([\d.]+) s/.exec(text ?? '')?.[1]) * 1000),
    );
    return ms.slice(1).map((at, i) => at - (ms[i] as number));
  };
  // At Steady, 0.05 virtual seconds a second: steps of 25 virtual ms.
  const steady = await steps();
  expect(steady.length).toBeGreaterThan(2);
  expect(new Set(steady)).toEqual(new Set([25]));
  // At Quick, twice as fast: steps of 50, so the choice changes the steps as it changes a run.
  await page.selectOption('[data-rf-speed]', '0.1');
  const quick = await steps();
  expect(quick.length).toBeGreaterThan(1);
  expect(new Set(quick)).toEqual(new Set([50]));
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('Next event says where the run stands when the log has nothing to tell', async ({ page }) => {
  await page.goto(RAFT);
  const said = page.locator('[data-rf-said]');
  const heard: string[] = [];
  let told = 0;
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Next event' }).click();
    await expect(said).not.toHaveText(heard.at(-1) ?? '');
    const words = (await said.textContent()) ?? '';
    heard.push(words);
    // An event the log does not tell is said as the clock and the status line count it.
    if (!words.startsWith('Virtual time')) continue;
    told += 1;
    const events = /over ([\d,]+) events/.exec((await status(page).textContent()) ?? '')?.[1];
    expect(words).toBe(`${await clock(page).textContent()}, ${events} events`);
  }
  // Each press is heard, and each says something new.
  expect(told).toBeGreaterThan(0);
  expect(new Set(heard).size).toBe(heard.length);
});

test('the app writes the event log once: the build’s lines go on as the run’s, and a link’s run shows only its own', async ({
  page,
}) => {
  await page.goto(RAFT);
  const built = await log(page).allTextContents();
  expect(built).toHaveLength(12);
  // Intent alone loads the app, which writes the run's log from its first line: 13 lines, each
  // once, the last 12 of them the build's.
  await page.locator('[data-rf-map]').hover();
  await expect(log(page)).toHaveCount(13);
  const lines = await log(page).allTextContents();
  expect(new Set(lines).size).toBe(lines.length);
  expect(lines.slice(-12)).toEqual(built);

  // A link's run writes its own log alone, the same as when the link is followed on the page.
  await page.goto(`${RAFT}#seed-8`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  const linked = await log(page).allTextContents();
  await page.evaluate(() => (location.hash = '#seed-9'));
  await expect(page.locator('[data-rf-seed]')).toHaveText('9');
  await page.evaluate(() => (location.hash = '#seed-8'));
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  expect(await log(page).allTextContents()).toEqual(linked);
  expect(linked).not.toEqual(lines);
});

test('Run says what it does next, Run or Pause, and has no pressed state', async ({ page }) => {
  await page.goto(RAFT);
  const run = page.locator('[data-rf-run]');
  await run.click();
  await expect(run).toHaveText('Pause');
  await expect(run).not.toHaveAttribute('aria-pressed');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await run.click();
  await expect(run).toHaveText('Run');
  await expect(run).not.toHaveAttribute('aria-pressed');
});

test('moving the loss slider after Next event draws the events it lets finish in that millisecond', async ({
  page,
}) => {
  await page.goto(RAFT);
  // Four events on from the opening, the run stands at 1.426 s with another event due then.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next event' }).click();
  await expect(clock(page)).toHaveText('Virtual time 1.426 s');
  await expect(status(page)).toHaveText('All five safety properties held over 253 events.');
  // The slider is an action: the run first finishes that millisecond, and the page shows it.
  await page.locator('[data-rf-loss]').fill('10');
  await expect(page.locator('[data-rf-loss-out]')).toHaveText('10%');
  await expect(status(page)).toHaveText('All five safety properties held over 254 events.');
  await expect(clock(page)).toHaveText('Virtual time 1.426 s');
});

test('a link followed on the page opens that seed paused at the opening’s moment, before or after the app has loaded', async ({
  page,
}) => {
  await page.goto(RAFT);
  // Followed before any intent: the link loads the app, which opens it, its loss and all.
  await page.evaluate(() => (location.hash = '#seed-12&loss=10'));
  await expect(page.locator('[data-rf-seed]')).toHaveText('12');
  await expect(clock(page)).toHaveText('Virtual time 1.400 s');
  await expect(page.locator('[data-rf-loss]')).toHaveValue('10');
  await expect(page.locator('[data-rf-loss-out]')).toHaveText('10%');
  // Followed while a run plays: that seed's opening, paused.
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => seconds(page)).toBeGreaterThan(1.45);
  await page.evaluate(() => (location.hash = '#seed-3'));
  await expect(page.locator('[data-rf-seed]')).toHaveText('3');
  await expect(clock(page)).toHaveText('Virtual time 1.400 s');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(clock(page)).toHaveText('Virtual time 1.400 s');
  // A hash that links to no run, as the skip link's, leaves the run alone.
  const lines = await log(page).allTextContents();
  await page.evaluate(() => (location.hash = '#main'));
  await page.waitForTimeout(200);
  await expect(page.locator('[data-rf-seed]')).toHaveText('3');
  expect(await log(page).allTextContents()).toEqual(lines);
});

test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over moves on', async ({
  page,
}) => {
  await page.goto(`${RAFT}#seed-8`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-rf-seed]')).toHaveText('9');
  expect(new URL(page.url()).hash).toBe('#seed-9');
  // A name the lab does not have is dropped, and the seed still opens.
  await page.goto(`${RAFT}#seed-12&foo=bar`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('12');
  // After the last seed a link can name, Start over comes back to 0, which a reload opens.
  await page.goto(`${RAFT}#seed-999999`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('999999');
  await page.getByRole('button', { name: 'Start over' }).click();
  expect(new URL(page.url()).hash).toBe('#seed-0');
  await page.reload();
  await expect(page.locator('[data-rf-seed]')).toHaveText('0');
});

test('Start over writes the loss into its link, and a reload opens the same run, which loses messages too', async ({
  page,
}) => {
  /** The run, forty events on from its opening. */
  const forty = async () => {
    for (let i = 0; i < 40; i++) await page.getByRole('button', { name: 'Next event' }).click();
    return [
      await clock(page).textContent(),
      await summary(page).textContent(),
      await status(page).textContent(),
      await page.locator('[data-rf-flights]').innerHTML(),
    ];
  };
  await page.goto(RAFT);
  await page.locator('[data-rf-loss]').fill('30');
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  expect(new URL(page.url()).hash).toBe('#seed-8&loss=30');
  expect(await page.evaluate(() => history.length)).toBe(entries);
  const before = await forty();
  await page.reload();
  await expect(page.locator('[data-rf-loss]')).toHaveValue('30');
  await expect(page.locator('[data-rf-loss-out]')).toHaveText('30%');
  expect(await forty()).toEqual(before);
  // The same seed without the loss is another run: the link is what tells them apart.
  await page.goto(`${RAFT}#seed-8`);
  await expect(page.locator('[data-rf-loss]')).toHaveValue('0');
  expect(await forty()).not.toEqual(before);
});

// The desk's lamps (ADR 0025): Run is a push-button whose lamp is off until the run is on and lit
// while it runs, said by data-lamp, since its words already change (Run, Pause) and a button whose
// words change is no toggle, so it carries no aria-pressed; a server and each log entry are lamps in the lab's own line, the colour its
// head runs across the page in, whatever the entry's term, which its number under it tells. Until
// then each term took one of the map's van colours, the Route Lab's yellow among them.
test('Run lights its lamp while the run is on, and every lamp on the desk is the lab’s line, whatever the term', async ({
  page,
}) => {
  await page.goto(RAFT);
  const run = page.locator('[data-rf-run]');
  const lamp = () => run.evaluate((button) => getComputedStyle(button, '::before').backgroundColor);
  await expect(run).toHaveAttribute('data-lamp', 'off');
  await expect(run).not.toHaveAttribute('aria-pressed');
  expect(await lamp()).toBe('rgba(0, 0, 0, 0)');
  await run.click();
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveAttribute('data-lamp', 'on');
  expect(await lamp()).not.toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Pause' }).click();
  const colours = await page.evaluate(() => {
    // An entry of another term, as a later run writes one, beside the opening's.
    document
      .querySelector('[data-rf-log="0"]')
      ?.insertAdjacentHTML(
        'beforeend',
        '<li class="rf-cell" data-term="2"><span class="rf-mark"></span><span class="rf-num">3</span></li>',
      );
    const line = getComputedStyle(document.querySelector('.page-line') as Element, '::before');
    return {
      line: line.backgroundColor,
      marks: [
        ...new Set(
          [...document.querySelectorAll('.rf-mark')].map((m) => getComputedStyle(m).borderTopColor),
        ),
      ],
      filled: [
        ...new Set(
          [...document.querySelectorAll('.rf-cell[data-done] .rf-mark')].map(
            (m) => getComputedStyle(m).backgroundColor,
          ),
        ),
      ],
      servers: [
        ...new Set(
          [...document.querySelectorAll('[data-rf-node] .rf-body')].map(
            (b) => getComputedStyle(b).stroke,
          ),
        ),
      ],
      round: getComputedStyle(document.querySelector('.rf-mark') as Element).borderRadius,
    };
  });
  expect(colours).toEqual({
    line: colours.line,
    marks: [colours.line],
    filled: [colours.line],
    servers: [colours.line],
    round: '50%',
  });
});

// The speed is a radio group (WAI-ARIA APG, "Radio Group Pattern"): named Speed, a radio a speed,
// Steady chosen; Tab stops once, on the chosen radio; the arrow keys choose the next, wrapping; the
// chosen one's lamp is lit and the others' are not; and a run goes at the speed chosen.
test('the speed is a radio group of lamps that the arrow keys move through, and the run goes at it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(RAFT);
  const group = page.getByRole('group', { name: 'Speed' });
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(3);
  const steady = group.getByRole('radio', { name: 'Steady' });
  const quick = group.getByRole('radio', { name: 'Quick' });
  const slow = group.getByRole('radio', { name: 'Slow' });
  await expect(steady).toBeChecked();

  await page.getByRole('button', { name: 'Next event' }).focus();
  await page.keyboard.press('Tab');
  await expect(steady).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(quick).toBeFocused();
  await expect(quick).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(slow).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(quick).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Start over' })).toBeFocused();

  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('.rf-option')].map(
      (option) =>
        getComputedStyle(option.querySelector('.rf-lamp') as Element).backgroundColor !==
        'rgba(0, 0, 0, 0)',
    ),
  );
  expect(lit).toEqual([false, false, true]);

  // Quick runs 0.1 virtual seconds a real one, twice Steady: a real second from Pause showing (the
  // app loaded and running) moves the clock past anything Steady could reach in it.
  await page.getByRole('button', { name: 'Run' }).click();
  const pause = page.getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();
  const from = await seconds(page);
  await page.waitForTimeout(1_000);
  await pause.click();
  expect((await seconds(page)) - from).toBeGreaterThan(0.07);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(RAFT);
    await page.getByRole('button', { name: 'Send a write' }).click();
    await page.getByRole('button', { name: 'Split 2 and 3' }).click();
    await page.getByRole('button', { name: 'Next event' }).click();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
