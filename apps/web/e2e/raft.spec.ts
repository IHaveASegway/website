import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Raft Lab in a browser (ADR 0020): without JavaScript the page is the opening run the build
// drew, with no control; with it, nothing moves or loads until the visitor shows intent, the
// simulation takes over at the picture's exact moment, runs only while Run is pressed (a toggle:
// a second press stops it), and keeps the five safety properties through a cut-off leader; under
// reduced motion it advances in discrete steps; and the page meets axe after a run, since script
// redrew it.

const RAFT = '/lab/raft/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const HELD = /^All five safety properties held over [\d,]+ events\.$/;

const clock = (page: Page) => page.locator('[data-rf-clock]');
/** The Run toggle: its name stays "Run", and aria-pressed says whether the run is on. */
const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true });
const summary = (page: Page) => page.locator('[data-rf-summary]');
const status = (page: Page) => page.locator('[data-rf-status]');

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

test('nothing loads or moves before intent; Run plays and a second press stops it, with no policy violation', async ({
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
  await run(page).click();
  await expect(run(page)).toHaveAttribute('aria-pressed', 'true');
  expect(app).toHaveLength(1);
  await expect.poll(() => seconds(page), { timeout: 5_000 }).toBeGreaterThan(opening + 0.02);
  await run(page).click();
  await expect(run(page)).toHaveAttribute('aria-pressed', 'false');
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
  await page.selectOption('[data-rf-speed]', '0.1');
  await run(page).click();
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
  await run(page).click();
  await expect(run(page)).toHaveAttribute('aria-pressed', 'false');
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

test('under reduce, Run advances in steps of 50 virtual ms, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(RAFT);
  const opening = await seconds(page);
  await run(page).click();
  await expect.poll(() => seconds(page), { timeout: 3_000 }).toBeGreaterThan(opening);
  await run(page).click();
  await expect(run(page)).toHaveAttribute('aria-pressed', 'false');
  const moved = Math.round(((await seconds(page)) - opening) * 1000);
  expect(moved % 50).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over moves on', async ({
  page,
}) => {
  await page.goto(`${RAFT}#seed-8`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-rf-seed]')).toHaveText('9');
  expect(new URL(page.url()).hash).toBe('#seed-9');
});

// The desk's lamps (ADR 0025): Run is a push-button whose lamp is hollow until the run is on and
// lit while it runs, and whose name stays "Run" either way, so the lamp, the state a screen reader
// hears and the word agree. Until 2026-10-30 the word turned to "Pause" while the lamp was lit:
// "Pause, pressed". A server and each log entry are lamps in the lab's own line, the colour its
// head runs across the page in, whatever the entry's term, which its number under it tells. Until
// then each term took one of the map's van colours, the Route Lab's yellow among them.
test('Run lights its lamp and keeps its name while the run is on, and every lamp on the desk is the lab’s line, whatever the term', async ({
  page,
}) => {
  await page.goto(RAFT);
  const button = page.locator('[data-rf-run]');
  const lamp = () =>
    button.evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAccessibleName('Run');
  expect(await lamp()).toBe('rgba(0, 0, 0, 0)');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAccessibleName('Run');
  expect(await lamp()).not.toBe('rgba(0, 0, 0, 0)');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAccessibleName('Run');
  // The lab's line as the stylesheet names it, read from a probe, so the drawing is tied to the
  // token and not only to itself.
  const token = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.setProperty('background-color', 'var(--line-raft)');
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  expect(token).not.toBe('rgba(0, 0, 0, 0)');
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
    line: token,
    marks: [token],
    filled: [token],
    servers: [token],
    round: '50%',
  });
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
