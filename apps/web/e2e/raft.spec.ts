import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { clockAnimations, handsOn } from './expected';

// The Raft Lab in a browser (ADR 0020): without JavaScript the page is the opening run the build
// drew, with no control; with it, nothing moves or loads until the visitor shows intent, the
// simulation takes over at the picture's exact moment, runs only between Run and Pause, and keeps
// the five safety properties through a cut-off leader; under reduced motion it advances in
// discrete steps; and the page meets axe after a run, since script redrew it.

const RAFT = '/lab/raft/';

test.beforeEach(({ page }) => handsOn(page));
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const HELD = /^All five safety properties held over [\d,]+ events\.$/;
const PROPERTIES = [
  'Election Safety',
  'Leader Append-Only',
  'Log Matching',
  'Leader Completeness',
  'State Machine Safety',
];
const SPLIT = 'Split two servers from three';

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

test('without JavaScript, the page is the opening run: five servers, three committed entries each, the properties named, no control', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(RAFT);
  await expect(page.locator('[data-rf-node]')).toHaveCount(5);
  await expect(page.locator('.rf-cell[data-done]')).toHaveCount(15);
  await expect(summary(page)).toHaveText(/^Server \d leads term \d+, 3 entries committed\.$/);
  await expect(status(page)).toHaveText(HELD);
  await expect(page.locator('.rf-prop-name')).toHaveText(PROPERTIES);
  await expect(page.locator('.rf-prop-word')).toHaveText(PROPERTIES.map(() => 'Held'));
  await expect(page.locator('.rf-controls')).toBeHidden();
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
  expect(await clockAnimations(page)).toBe(0);

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
  const [, oldLeader, oldTerm] = /^Server (\d) leads term (\d+)/.exec(before) ?? [];
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  // The old leader still leads its own term on its side; the majority elects a newer one.
  await expect
    .poll(
      async () => {
        const [, leader, term] =
          /^Server (\d) leads term (\d+)/.exec((await summary(page).textContent()) ?? '') ?? [];
        return leader !== undefined && leader !== oldLeader && Number(term) > Number(oldTerm);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(status(page)).toHaveText(HELD);
  await expect(page.locator('[data-rf-lines]')).toContainText('The network splits');
});

/** How the cut's fence meets each server as drawn: its timer ring with half its stroke, and each
 *  line of text with its halo. Each server must be wholly inside the fence or wholly outside it,
 *  and never under its line. Says how many servers are inside, or what went wrong. */
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
        // getBBox leaves out a CSS transform, and on a phone the labels move down as they grow.
        const shift = new DOMMatrix(getComputedStyle(text).transform).f;
        const box = text.getBBox();
        const { x, width, height } = box;
        const y = box.y + shift;
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
      if (points.some((p) => cut.isPointInStroke(p))) return `the line crosses server ${id}`;
      const within = points.filter((p) => cut.isPointInFill(p)).length;
      if (within === points.length) inside++;
      else if (within > 0) return `server ${id} is partly inside`;
    }
    return inside;
  });

test('a split network: a fence closes off the smaller side and crosses no server or its text', async ({
  page,
}) => {
  await page.goto(RAFT);
  await expect.poll(() => fenced(page)).toBe('no fence');
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  await expect.poll(() => fenced(page)).toBe(1);
  await page.getByRole('button', { name: 'Heal the network' }).click();
  await expect.poll(() => fenced(page)).toBe('no fence');
  await page.getByRole('button', { name: SPLIT }).click();
  await expect.poll(() => fenced(page)).toBe(2);
});

// On a phone the role and term grow and move down (raft-lab.css), and from 64rem the term grows a
// little; the fence must still keep clear.
for (const [width, height] of [
  [390, 844],
  [320, 844],
  [1440, 900],
] as const) {
  test(`at ${width} px wide, the fence still crosses no server or its text`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RAFT);
    await page.getByRole('button', { name: 'Cut off the leader' }).click();
    await expect.poll(() => fenced(page)).toBe(1);
    await page.getByRole('button', { name: 'Heal the network' }).click();
    await page.getByRole('button', { name: SPLIT }).click();
    await expect.poll(() => fenced(page)).toBe(2);
  });
}

test('a server’s button crashes it and then restarts it, and says so in its name', async ({
  page,
}) => {
  await page.goto(RAFT);
  const first = page.locator('[data-rf-toggle="0"]');
  await expect(first).toHaveText('Crash server 1');
  await expect(first).toHaveAccessibleName('Crash server 1, now leader, term 1');
  await first.click();
  await expect(first).toHaveText('Restart server 1');
  await expect(first).toHaveAccessibleName('Restart server 1, now down');
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'false');
  await first.click();
  await expect(first).toHaveText('Crash server 1');
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'true');
});

// A crash clears what a server knows is committed (Figure 2's commitIndex is volatile), and a new
// leader can't count an older term's entries (section 5.4.2), so with all five crashed no server
// knows of any. What a majority holds is still committed, so the caption's count stays: it read "0
// entries committed" under a log line saying a write could never be lost until 2026-11-02.
test('crash all five and the caption still says 3, through a new leader, until a write makes it 4', async ({
  page,
}) => {
  await page.goto(RAFT);
  for (let id = 0; id < 5; id++) await page.locator(`[data-rf-toggle="${id}"]`).click();
  await expect(summary(page)).toHaveText('No leader, 3 entries committed, 5 servers down.');
  await expect(page.locator('.rf-cell[data-done]')).toHaveCount(0);
  for (let id = 0; id < 5; id++) await page.locator(`[data-rf-toggle="${id}"]`).click();
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(summary(page)).toHaveText(/^Server \d leads term \d+, 3 entries committed\.$/, {
    timeout: 15_000,
  });
  await expect(page.locator('.rf-cell[data-done]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send a write' }).click();
  await expect(summary(page)).toHaveText(/^Server \d leads term \d+, 4 entries committed\.$/, {
    timeout: 15_000,
  });
  await expect(page.locator('.rf-cell[data-done]').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
});

// The picture draws what each server thinks, so a leader cut off from the rest is still drawn as one,
// and the caption says so at that moment: "No leader" under a server labelled leader read as a bug.
test('with its leader cut off, the caption says who still thinks it leads, during the election and after it', async ({
  page,
}) => {
  await page.goto(RAFT);
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  const next = page.getByRole('button', { name: 'Next event' });
  const candidate = page.locator('[data-rf-node][data-role="candidate"]');
  for (let i = 0; i < 400 && (await candidate.count()) === 0; i++) await next.click();
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-role', 'leader');
  await expect(summary(page)).toHaveText(
    /^No leader in term 2, 3 entries committed, the network is split\. Server 1 still thinks it leads term 1\.$/,
  );
  const elected = page.locator('[data-rf-node][data-role="leader"]');
  for (let i = 0; i < 400 && (await elected.count()) < 2; i++) await next.click();
  await expect(summary(page)).toHaveText(
    /^Server [2-5] leads term 2, 3 entries committed, the network is split\. Server 1 still thinks it leads term 1\.$/,
  );
});

// The lead says to watch the five safety properties, so the page names them, Figure 3's own words,
// each with its state, as the other labs do their checks. They stand beside the picture from 64rem.
test('the desk names the five safety properties, each with its state', async ({ page }) => {
  await page.goto(RAFT);
  const rows = page.locator('[data-rf-prop]');
  await expect(page.locator('.rf-prop-name')).toHaveText(PROPERTIES);
  await expect(rows).toHaveCount(5);
  for (const row of await rows.all()) await expect(row).toHaveAttribute('data-held', 'true');
  await expect(page.locator('[data-rf-prop-word]')).toHaveText(PROPERTIES.map(() => 'Held'));
  await expect(page.getByRole('list', { name: /^Safety properties/ })).toBeVisible();
  // The lamp the table gives each state: filled while it holds, crossed once it broke, both in the
  // lab's line. The page's servers never break one, so the mark is set by hand to read it.
  const lamp = () =>
    rows.first().evaluate((row) => {
      const part = row.querySelector('.rf-prop-lamp') as Element;
      return {
        fill: getComputedStyle(part).backgroundColor,
        ring: getComputedStyle(part).borderTopColor,
        cross: getComputedStyle(part, '::before').content,
      };
    });
  const holding = await lamp();
  expect(holding.fill).toBe(holding.ring);
  expect(holding.cross).toBe('none');
  await rows.first().evaluate((row) => row.setAttribute('data-held', 'false'));
  const broken = await lamp();
  expect(broken.fill).toBe('rgba(0, 0, 0, 0)');
  expect(broken.ring).toBe(holding.ring);
  expect(broken.cross).toBe('""');
});

test('from 64rem the properties share the first screen with the picture they describe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RAFT);
  const last = await page.locator('[data-rf-prop]').last().boundingBox();
  const map = await page.locator('[data-rf-map]').boundingBox();
  expect(last && last.y + last.height).toBeLessThanOrEqual(900);
  expect(last && map && last.x).toBeGreaterThan((map?.x ?? 0) + (map?.width ?? 0));
});

// Run under the fold was the desk's first impression on a laptop: a picture and a list, and nothing
// to press. Until 2026-11-02 it stood at 900 of 900, once the properties came to stand beside the
// picture. Measured from the top of the page, not the picture's: that test passed all along.
for (const fonts of ['loaded', 'blocked'] as const) {
  test(`at 1440 by 900, all of the picture, the properties and Run are on the first screen, fonts ${fonts}`, async ({
    page,
  }) => {
    if (fonts === 'blocked') await page.route('**/*.woff2', (route) => route.abort());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(RAFT);
    await page.evaluate(() => document.fonts.ready);
    const bottoms = await page.evaluate(() =>
      ['[data-rf-map]', '[data-rf-summary]', '[data-rf-status]', '[data-rf-run]'].map(
        (selector) => (document.querySelector(selector) as Element).getBoundingClientRect().bottom,
      ),
    );
    expect(Math.max(...bottoms)).toBeLessThanOrEqual(900);
  });
}

test('on a screen tall enough for both, the picture keeps its full size', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(RAFT);
  const map = await page.locator('[data-rf-map]').boundingBox();
  const run = await page.locator('[data-rf-run]').boundingBox();
  expect(map?.width).toBe(448);
  expect(run && run.y + run.height).toBeLessThanOrEqual(1080);
});

// The room the caption keeps at every width the desk changes at, for its longest words, with each
// number a digit longer than a run makes it (e2e/steady.spec.ts holds the two phones, in WebKit). And
// the line under Time, for the longest a press says here.
for (const width of [384, 768, 1024, 1440]) {
  test(`at ${width} px wide, the caption and the line under Time keep the room of their longest words`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RAFT);
    const hold = async (part: ReturnType<Page['locator']>, words: string) => {
      const before = await part.boundingBox();
      await part.evaluate((p, text) => {
        p.textContent = text;
      }, words);
      const after = await part.boundingBox();
      expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
    };
    await hold(
      summary(page),
      'No leader in term 123, 1000 entries committed, 2 servers down, the network is split. Servers 1 and 3 and 4 still think they lead older terms.',
    );
    await hold(
      page.locator('[data-said]'),
      'The run starts over under these settings, at 1.400 s, before the leader crashes. Press Run to watch it.',
    );
  });
}

// What the app writes as well as what the build drew: the glossary's word for Raft, and the paper's
// (docs/content.md, "The site's language"; test/raft.test.ts reads the words a run can write).
test('a visitor reads server, never node, in the words and in the names, after the app has redrawn them', async ({
  page,
}) => {
  await page.goto(RAFT);
  await page.locator('[data-rf-toggle="0"]').click();
  await page.getByRole('button', { name: SPLIT }).click();
  await page.getByRole('button', { name: 'Send a write' }).click();
  await expect(page.locator('[data-rf-toggle="0"]')).toHaveText('Restart server 1');
  const read = await page.locator('#raft-lab').evaluate((desk) => ({
    words: (desk as HTMLElement).innerText,
    names: [...desk.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')),
  }));
  expect(read.words).toContain('Server 5');
  expect(read.names).toContain('Server 1: 3 entries, none known committed, last of term 1');
  expect(read.words).not.toMatch(/\bnodes?\b/i);
  expect(read.names.filter((name) => /\bnodes?\b/i.test(name ?? ''))).toEqual([]);
});

// A log's row keeps one line however long its log grows. Until 2026-11-02 a row wrapped at about 20
// entries, and Run and every control under it dropped 37 px at 1,440 px, on the first screen.
for (const [width, height] of [
  [1440, 900],
  [390, 664],
] as const) {
  test(`at ${width} by ${height}, forty writes move nothing, and each log stays one line that opens on its newest`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RAFT);
    const places = () =>
      page.evaluate(() => {
        const top = (selector: string) =>
          Math.round(
            (document.querySelector(selector) as Element).getBoundingClientRect().top + scrollY,
          );
        return {
          run: top('[data-rf-run]'),
          row: (document.querySelector('.rf-log') as Element).getBoundingClientRect().height,
          read: top('.rf-read'),
          props: top('.rf-props-part'),
          events: top('.rf-events'),
          page: document.documentElement.scrollHeight,
        };
      });
    const before = await places();
    const write = page.locator('[data-rf-write]');
    for (let i = 0; i < 40; i++) await write.click();
    for (let i = 0; i < 80; i++) await page.locator('[data-rf-step]').click();
    await expect(page.locator('[data-rf-log="0"] .rf-cell')).toHaveCount(43);
    expect(await places()).toEqual(before);
    const box = page.locator('.rf-logs-box');
    const shows = (cell: string) =>
      box.evaluate((frame, selector) => {
        const dot = (frame.querySelector(selector) as Element).getBoundingClientRect();
        const name = (frame.querySelector('.rf-log-name') as Element).getBoundingClientRect();
        return dot.left >= name.right - 1 && dot.right <= frame.getBoundingClientRect().right + 1;
      }, cell);
    const newest = '[data-rf-log="0"] .rf-cell:last-child';
    const oldest = '[data-rf-log="0"] .rf-cell:first-child';
    expect(await box.evaluate((frame) => frame.scrollTop)).toBe(0);
    expect(await shows(newest)).toBe(true);
    expect(await shows(oldest)).toBe(false);
    // Reached by scrolling back, the names standing where they were; and a keyboard can get there.
    await box.focus();
    const name = await box.locator('.rf-log-name').first().boundingBox();
    await box.evaluate((frame) => {
      frame.scrollLeft = -frame.scrollWidth;
    });
    expect(await shows(oldest)).toBe(true);
    expect(await box.locator('.rf-log-name').first().boundingBox()).toEqual(name);
  });
}

// Each server's button keeps one width as its word changes, so the next one stays under the thumb.
for (const width of [390, 320]) {
  test(`at ${width} px wide, a server’s button keeps its place and width from Crash to Restart`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(RAFT);
    const boxes = () =>
      page
        .locator('[data-rf-toggle]')
        .evaluateAll((all) =>
          all.map((b) => ((r) => [r.x, r.y + scrollY, r.width])(b.getBoundingClientRect())),
        );
    const before = await boxes();
    await page.locator('[data-rf-toggle="0"]').click();
    await expect(page.locator('[data-rf-toggle="0"]')).toHaveText('Restart server 1');
    expect(await boxes()).toEqual(before);
  });
}

test('the key names each mark on the wire in the picture’s own marks, and what a term is stands by the picture', async ({
  page,
}) => {
  await page.goto(RAFT);
  const kinds = await page
    .locator('.rf-key .rf-m')
    .evaluateAll((marks) => marks.map((m) => m.getAttribute('data-kind')));
  expect(kinds.sort()).toEqual(['ack', 'beat', 'entries', 'no', 'vote', 'yes']);
  await expect(page.locator('.rf-key')).toContainText('Network split');
  await expect(page.locator('.rf-gloss')).toHaveText(
    'A term is a numbered stretch of time with at most one leader.',
  );
  // The picture is named by the caption alone, which every change rewrites.
  await expect(page.locator('[data-rf-map]')).toHaveAccessibleName(
    /^Server 1 leads term 1, 3 entries committed\.$/,
  );
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
  await page.getByRole('radio', { name: 'Quick' }).check();
  const quick = await steps();
  expect(quick.length).toBeGreaterThan(1);
  expect(new Set(quick)).toEqual(new Set([50]));
  expect(await clockAnimations(page)).toBe(0);
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

// Until 2026-11-02 these reached only a screen reader, and a press that did nothing looked dead.
test('why a press did nothing is on the screen: Heal on a whole network, Cut off with no leader', async ({
  page,
}) => {
  await page.goto(RAFT);
  const line = page.locator('[data-said]');
  await expect(line).toHaveCount(1);
  await expect(line).toBeVisible();
  await expect(line).toHaveText('The network and the servers below change the run as it stands.');
  await expect(line).not.toHaveAttribute('data-spoke');

  await page.getByRole('button', { name: 'Heal the network' }).click();
  await expect(line).toHaveText('The network is already whole.');
  await expect(line).toHaveAttribute('data-spoke');
  await expect(page.locator('[data-rf-said]')).toHaveText('The network is already whole.');

  // A press that does something says what, the log's line with its point.
  await page.getByRole('button', { name: SPLIT }).click();
  await expect(line).toHaveText('The network splits: {1, 2} and {3, 4, 5}.');
  await page.getByRole('button', { name: 'Heal the network' }).click();
  await expect(line).toHaveText('The network heals: every server can reach every other.');

  // No leader, all five down.
  for (let id = 0; id < 5; id++) await page.locator(`[data-rf-toggle="${id}"]`).click();
  await expect(line).toHaveText(
    /^Server 5 crashes\. It keeps its term, its vote and its log on disk\.$/,
  );
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  await expect(line).toHaveText('There is no leader to cut off right now.');
  await expect(line).toBeVisible();

  // Start over says where it went, and what it waits for.
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(line).toHaveText(
    'The run starts over under these settings, at 1.400 s. Press Run to watch it.',
  );
  // Run has nothing to say, so the line goes back to what these controls do.
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(line).not.toHaveAttribute('data-spoke');
  await expect(line).toHaveText('The network and the servers below change the run as it stands.');
  await page.getByRole('button', { name: 'Pause' }).click();

  await page.locator('[data-rf-loss]').fill('30');
  await expect(line).toHaveText('From here, 30% of messages are lost.');
});

// A tap on a server in the picture has no part of the controls to speak in, so it speaks in the first.
test('a tap on a server in the picture says what it did on the line under Time', async ({
  page,
}) => {
  await page.goto(RAFT);
  await page.locator('[data-rf-node="4"] .rf-name').click();
  await expect(page.locator('[data-said]')).toHaveText(
    'Server 5 crashes. It keeps its term, its vote and its log on disk.',
  );
});

test('the app writes the event log once: the build’s lines are the run’s, from its first, and a link’s run shows only its own', async ({
  page,
}) => {
  await page.goto(RAFT);
  const built = await log(page).allTextContents();
  // The whole of it, from the first server to stand: the build's last 12 opened on a server winning
  // an election with no line saying it stood, a line the app then added above them.
  expect(built).toHaveLength(13);
  expect(built[0]).toContain('times out and asks for votes in term 1');
  // Intent alone loads the app, which writes the run's log from its first line: the same 13 lines,
  // each once.
  await page.locator('[data-rf-map]').hover();
  await expect(clock(page)).toHaveText('Virtual time 1.400 s');
  await expect(log(page)).toHaveCount(13);
  await expect.poll(() => log(page).allTextContents()).toEqual(built);
  const lines = await log(page).allTextContents();
  expect(new Set(lines).size).toBe(lines.length);

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

// Start over keeps the seed and the loss, as the other three labs do, so the run just seen can be
// watched again. Until 2026-11-02 it moved to the next seed, which this test pinned.
test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over stays on it', async ({
  page,
}) => {
  await page.goto(`${RAFT}#seed-8`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  expect(new URL(page.url()).hash).toBe('#seed-8');
  // A name the lab does not have is dropped, and the seed still opens.
  await page.goto(`${RAFT}#seed-12&foo=bar`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('12');
  // The last seed a link can name, too, which a reload opens again.
  await page.goto(`${RAFT}#seed-999999`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('999999');
  await page.getByRole('button', { name: 'Start over' }).click();
  expect(new URL(page.url()).hash).toBe('#seed-999999');
  await page.reload();
  await expect(page.locator('[data-rf-seed]')).toHaveText('999999');
});

test('Start over shows the same run again from the same opening: what the presses made goes, and the seed stays', async ({
  page,
}) => {
  await page.goto(RAFT);
  await page.locator('[data-rf-map]').hover();
  await expect(log(page)).toHaveCount(13);
  const opening = await log(page).allTextContents();
  /** Forty events on, as a run of this seed goes. */
  const forty = async () => {
    for (let i = 0; i < 40; i++) await page.getByRole('button', { name: 'Next event' }).click();
    return [
      await clock(page).textContent(),
      await status(page).textContent(),
      await page.locator('[data-rf-flights]').innerHTML(),
    ];
  };
  const seen = await forty();
  await page.getByRole('button', { name: 'Send a write' }).click();
  await page.locator('[data-rf-toggle="0"]').click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-rf-seed]')).toHaveText('7');
  expect(new URL(page.url()).hash).toBe('#seed-7');
  await expect(clock(page)).toHaveText('Virtual time 1.400 s');
  await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
  expect(await log(page).allTextContents()).toEqual(opening);
  expect(await forty()).toEqual(seen);
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
  await expect(page.locator('[data-rf-seed]')).toHaveText('7');
  expect(new URL(page.url()).hash).toBe('#seed-7&loss=30');
  expect(await page.evaluate(() => history.length)).toBe(entries);
  const before = await forty();
  await page.reload();
  await expect(page.locator('[data-rf-loss]')).toHaveValue('30');
  await expect(page.locator('[data-rf-loss-out]')).toHaveText('30%');
  expect(await forty()).toEqual(before);
  // The same seed without the loss is another run: the link is what tells them apart.
  await page.goto(`${RAFT}#seed-7`);
  await expect(page.locator('[data-rf-loss]')).toHaveValue('0');
  expect(await forty()).not.toEqual(before);
});

// The desk's lamps (ADR 0025): Run is a push-button whose lamp is off until the run is on and lit
// while it runs, said by data-lamp, since its words already change (Run, Pause) and a button whose
// words change is no toggle, so it carries no aria-pressed; a server and each log entry are lamps
// in the lab's own line, --line-raft, the colour its glyph draws in (ADR 0027; until then its head
// ran a line across the page in it), whatever the entry's term, which its number under it tells.
// Until then each term took one of the map's van colours, the Route Lab's yellow among them.
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
        '<li class="rf-cell"><span class="rf-mark"></span><span class="rf-num">3</span></li>',
      );
    // The lab's own line token, as the page resolves it, read from a probe on the desk.
    const probe = document.createElement('span');
    probe.style.setProperty('border-top', '1px solid var(--line-raft)');
    document.querySelector('#raft-lab')?.append(probe);
    const line = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return {
      line,
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

// A server's lamp is the site's mark for its state (design-system.md, "Lamps: one meaning per
// mark"): hollow while it follows, lit while it stands for election, filled while it leads, and
// hollow down its middle while it is down, its ring at a track's weight with the desk's surface
// over it, as the Queue Lab's down worker is. No server is ever dashed or dotted: a dashed ring is
// the Queue Lab's order taken and not yet acknowledged. The timer's dial is a gauge, in --input on
// every server that is up, the leader's too, and never the lit lamp's colour; a down server has
// none. Read in both themes, since the lit lamp is warm white at night and ink by day.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`each server is the table's lamp for its state, and none is a dashed ring, ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(RAFT);
    const servers = () =>
      page.evaluate(() => {
        const map = document.querySelector('[data-rf-map]') as SVGSVGElement;
        // A token as the picture resolves it, read from a probe inside it, by name.
        const token = (property: string) => {
          const probe = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          map.append(probe);
          probe.style.setProperty('fill', `var(${property})`);
          const colour = getComputedStyle(probe).fill;
          probe.remove();
          return colour;
        };
        const tokens = ['--line', '--surface-1', '--primary', '--input'].map(
          (property) => [property, token(property)] as const,
        );
        const name = (colour: string) => tokens.find(([, v]) => v === colour)?.[0] ?? colour;
        return [...map.querySelectorAll('[data-rf-node]')].map((node) => {
          const part = (selector: string) => getComputedStyle(node.querySelector(selector)!);
          const body = part('.rf-body');
          return {
            state:
              node.getAttribute('data-up') === 'false' ? 'down' : node.getAttribute('data-role'),
            fill: name(body.fill),
            stroke: name(body.stroke),
            weight: body.strokeWidth,
            dashes: body.strokeDasharray,
            gap: name(part('.rf-gap').stroke),
            dial: name(part('.rf-dial').stroke),
            track: part('.rf-track').stroke === 'none' ? 'none' : 'drawn',
          };
        });
      });
    const up = { stroke: '--line', weight: '2.5px', dashes: 'none', gap: 'none', track: 'drawn' };
    const lamp = {
      follower: { ...up, fill: '--surface-1', dial: '--input' },
      candidate: { ...up, fill: '--primary', dial: '--input' },
      leader: { ...up, fill: '--line', dial: '--input' },
      down: {
        fill: '--surface-1',
        stroke: '--line',
        weight: '6px',
        dashes: 'none',
        gap: '--surface-1',
        dial: 'none',
        track: 'none',
      },
    } as Record<string, object>;
    const seen = new Set<string>();
    const check = async () => {
      for (const { state, ...drawn } of await servers()) {
        seen.add(String(state));
        expect(drawn, `a ${state}`).toEqual(lamp[String(state)]);
      }
    };
    // The opening: a leader and four followers.
    await check();
    // Crash the leader, then step until another server stands for election. The seed is fixed,
    // so the same steps reach it every time.
    const leader = await page
      .locator('[data-rf-node][data-role="leader"]')
      .getAttribute('data-rf-node');
    await page.locator(`[data-rf-toggle="${leader}"]`).click();
    await expect(page.locator(`[data-rf-node="${leader}"]`)).toHaveAttribute('data-up', 'false');
    const candidate = page.locator('[data-rf-node][data-role="candidate"]');
    for (let i = 0; i < 100 && (await candidate.count()) === 0; i++)
      await page.getByRole('button', { name: 'Next event' }).click();
    await check();
    expect([...seen].sort()).toEqual(['candidate', 'down', 'follower', 'leader']);
  });
}

// The speed is a radio group (WAI-ARIA APG, "Radio Group Pattern"), the Time group's in every lab
// (components/lab/Choice.astro): named Speed, a radio a speed,
// Steady chosen; Tab stops once, on the chosen radio; the arrow keys choose the next, wrapping; the
// chosen one's lamp is lit and the others' are not; and a run goes at the speed chosen.
test('the speed is a radio group of lamps that the arrow keys move through, and the run goes at it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(RAFT);
  const group = page.getByRole('radiogroup', { name: 'Speed' });
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(3);
  const steady = group.getByRole('radio', { name: 'Steady' });
  const quick = group.getByRole('radio', { name: 'Quick' });
  const slow = group.getByRole('radio', { name: 'Slow' });
  await expect(steady).toBeChecked();

  // Start over stands before the speed, so the three time buttons share a line on a phone.
  await page.getByRole('button', { name: 'Start over' }).focus();
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
  await expect(page.getByRole('button', { name: 'Send a write' })).toBeFocused();

  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('.lab-option')].map(
      (option) =>
        getComputedStyle(option.querySelector('.lab-option-lamp') as Element).backgroundColor !==
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

/** From the top of the picture to the bottom of the lowest of these buttons, in CSS px: what one
 *  screen must hold to show the picture and the buttons that work it together. Says also whether
 *  anything from the picture up to the desk pins, which the site never does on a narrow screen. */
const reach = (page: Page, names: string[]) =>
  page.evaluate((names) => {
    const map = document.querySelector('[data-rf-map]') as SVGSVGElement;
    const top = map.getBoundingClientRect().top;
    const bottoms = names.map((name) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === name,
      );
      return button ? button.getBoundingClientRect().bottom : Number.POSITIVE_INFINITY;
    });
    let pinned = '';
    for (let el: Element | null = map; el && !el.matches('.desk'); el = el.parentElement)
      if (/sticky|fixed/.test(getComputedStyle(el).position)) pinned = el.className.toString();
    return { span: Math.max(...bottoms) - top, pinned };
  }, names);

// The first thing to try is Run, then Cut off the leader, then Send a write: those buttons and
// Time's sit by the picture, so a press and what it does share one screen.
test('at 1440 × 900, the picture and Time, Cut off the leader and Send a write fit one screen, and nothing pins', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RAFT);
  await page.evaluate(() => document.fonts.ready);
  const { span, pinned } = await reach(page, [
    'Run',
    'Next event',
    'Start over',
    'Cut off the leader',
    'Send a write',
  ]);
  expect(pinned).toBe('');
  expect(span).toBeLessThanOrEqual(900);
});

// On a phone it's what Safari shows of an iPhone 14 with its bars up, the phone project's own viewport.
// Until 2026-11-02 this read 844, the whole screen, which no page gets (labs-m4). The picture and Time
// fit that. The network's first row doesn't: it's 60 px past it, so reaching it takes at most the
// picture's top quarter off the screen, and the press, its line and most of the picture share one.
test('at 390 × 664, the picture and Time fit one screen, Cut off the leader stands with most of the picture, and nothing pins', async ({
  page,
}) => {
  const height = 664;
  await page.setViewportSize({ width: 390, height });
  await page.goto(RAFT);
  await page.evaluate(() => document.fonts.ready);
  const time = await reach(page, ['Run', 'Next event', 'Start over']);
  expect(time.pinned).toBe('');
  expect(time.span).toBeLessThanOrEqual(height);
  const map = await page.locator('[data-rf-map]').boundingBox();
  const { span } = await reach(page, ['Cut off the leader', 'Send a write']);
  expect(span - height).toBeLessThanOrEqual((map?.height ?? 0) / 4);
});

// A server's role and term are set in the picture's units, which shrink with its width; they must
// still draw 13 px at the least, and the leader's number above them more. 1,024 px is the desk's
// narrowest beside the logs, and 1,440 by 900 is where the picture stops at its smallest.
for (const [width, height] of [
  [390, 844],
  [320, 844],
  [1024, 768],
  [1440, 900],
] as const) {
  test(`at ${width} px wide, every label in the picture draws 13 px or more`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RAFT);
    const sizes = await page
      .locator('[data-rf-map] text')
      .evaluateAll((texts) =>
        texts.map(
          (t) =>
            parseFloat(getComputedStyle(t).fontSize) *
            ((t as SVGTextElement).getScreenCTM()?.a ?? 0),
        ),
      );
    expect(sizes).toHaveLength(15);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
  });
}

test('the loss slider is a 44 px target on a phone, as the buttons beside it are', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RAFT);
  await page.locator('[data-rf-loss]').scrollIntoViewIfNeeded();
  const box = await page.locator('[data-rf-loss]').boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  // A tap near the box's top edge, off the track drawn in its middle, still moves it.
  if (!box) return;
  await page.mouse.click(box.x + box.width * 0.75, box.y + 4);
  await expect(page.locator('[data-rf-loss]')).not.toHaveValue('0');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(RAFT);
    await page.getByRole('button', { name: 'Send a write' }).click();
    await page.getByRole('button', { name: SPLIT }).click();
    await page.getByRole('button', { name: 'Next event' }).click();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
