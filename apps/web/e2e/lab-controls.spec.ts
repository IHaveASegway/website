import { expect, test, type Page } from '@playwright/test';
import { handsOn } from './expected';

// The same controls on every desk (docs/lab.md, "The controls"; design-system.md). Until 2026-11-02
// the same control had three looks: radios rounded and joined in two labs, square and separate in a
// third, square and joined in another, and the clock and Speed stood in a different place in each.
// On a phone one lab's Speed was 650 px below its Run. The Raft Lab keeps its own markup for now, and
// is held to the same look from the outside.

const LABS = [
  { name: 'queue', short: 'qu' },
  { name: 'cache', short: 'cl' },
  { name: 'backfill', short: 'bf' },
  { name: 'raft', short: 'rf' },
] as const;

test.beforeEach(({ page }) => handsOn(page));

for (const lab of LABS) {
  test(`the ${lab.name} lab's radios are push-buttons with a control's corners, joined edge to edge`, async ({
    page,
  }) => {
    await page.goto(`/lab/${lab.name}/`);
    const looks = await page.locator('label.btn:has(input[type="radio"])').evaluateAll((options) =>
      options.map((option) => {
        const next = option.nextElementSibling;
        const box = option.getBoundingClientRect();
        return {
          radius: getComputedStyle(option).borderTopLeftRadius,
          // On one line, a button's edge lies over its neighbour's.
          joined:
            !next ||
            next.getBoundingClientRect().top !== box.top ||
            Math.round(next.getBoundingClientRect().left - box.right) === -1,
          tall: box.height >= 44,
        };
      }),
    );
    expect(looks.length).toBeGreaterThan(2);
    for (const look of looks) expect(look).toEqual({ radius: '4px', joined: true, tall: true });
  });
}

const THREE = LABS.filter((lab) => lab.name !== 'raft');

for (const lab of THREE) {
  /** The Time group's parts in the order the page holds them. */
  const order = (page: Page) =>
    page.locator(`#${lab.name}-lab .lab-time`).evaluate((group) => {
      const seen = [...group.querySelectorAll('.lab-clock, button, .lab-choice-inline')];
      return seen.flatMap((part) => {
        if (part.matches('.lab-clock')) return part.matches('.qu-ahead') ? [] : ['the clock'];
        if (part.matches('.lab-choice-inline')) return ['Speed'];
        return [part.textContent?.trim() ?? ''];
      });
    });

  test(`the ${lab.name} lab's Time group goes clock, Run, Next event, Start over, Speed`, async ({
    page,
  }) => {
    await page.goto(`/lab/${lab.name}/`);
    expect(await order(page)).toEqual(['the clock', 'Run', 'Next event', 'Start over', 'Speed']);
    await expect(page.getByRole('radiogroup', { name: 'Speed' })).toBeVisible();
    // The clock counts its events as every lab's does, and names its seed.
    await expect(page.locator(`#${lab.name}-lab .lab-time .lab-clock`).first()).toHaveText(
      /, [\d,]+ events, seed \d+$/,
    );
  });

  test(`on a phone, the ${lab.name} lab's Speed stands right under its Run`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto(`/lab/${lab.name}/`);
    const run = await page.locator(`[data-${lab.short}-run]`).boundingBox();
    const speed = await page.getByRole('radiogroup', { name: 'Speed' }).boundingBox();
    if (!run || !speed) throw new Error('no Run or no Speed');
    expect(speed.y).toBeGreaterThan(run.y);
    expect(speed.y + speed.height - (run.y + run.height)).toBeLessThan(70);
  });

  test(`the ${lab.name} lab's every list of checks has the same heading, and its log the same box`, async ({
    page,
  }) => {
    await page.goto(`/lab/${lab.name}/`);
    await expect(page.getByRole('heading', { name: 'Checked as the run goes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible();
    const log = await page.locator('[role="log"]').evaluate((box) => {
      const style = getComputedStyle(box);
      return [style.flexDirection, style.overflowY, style.blockSize];
    });
    expect(log[0]).toBe('column-reverse');
    expect(log[1]).toBe('auto');
  });
}

// What a press says stands beside the press: the far parts of a desk have a line of their own, and a
// press clears the other line, which goes back to saying what its controls do.
test('a press speaks in its own part of the controls, and the other part goes back to rest', async ({
  page,
}) => {
  await page.goto('/lab/cache/');
  const [first, second] = [page.locator('[data-said]').first(), page.locator('[data-said]').last()];
  const resting = await first.textContent();
  await page.locator('[data-cl-flush]').click();
  await expect(second).toHaveText(/^The cache is flushed: every node is empty/);
  await expect(second).toHaveAttribute('data-spoke');
  await expect(first).toHaveText(resting ?? '');
  await page.locator('[data-cl-step]').click();
  await expect(first).toHaveAttribute('data-spoke');
  await expect(second).not.toHaveAttribute('data-spoke');
  await expect(second).toHaveText((await second.getAttribute('data-said')) ?? '');
});

test('why a press did nothing is on the screen too: Clear on a week with the job off', async ({
  page,
}) => {
  await page.goto('/lab/backfill/');
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.locator('[data-bf-clear]').click();
  await expect(page.locator('[data-said]').last()).toHaveText(
    'Monday has no run to clear while the job is off.',
  );
  await expect(page.locator('[data-said]').last()).toBeVisible();
});

// Run means one thing in all three: it plays, and when the run stands where the picture told it, or
// has nothing more to show, it plays the story again from before it happens.
test('a queue that has drained stops the clock, says why, and Run plays the run again', async ({
  page,
}) => {
  await page.goto('/lab/queue/');
  const run = page.locator('[data-qu-run]');
  await page.locator('label:has(input[name="qu-speed"][value="5"])').click();
  await page.locator('[data-qu-crash="1"]').click(); // worker 2, down at the opening, comes back
  await page.locator('[data-qu-producer]').click();
  await run.click();
  await expect(page.locator('[data-said]').first()).toHaveText(
    /^Nothing is left in the queue or in flight, so the clock stops here\./,
    { timeout: 20_000 },
  );
  await expect(run).toHaveText('Run');
  const stopped = await page.locator('[data-qu-clock]').textContent();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-qu-clock]')).toHaveText(stopped ?? '');
  await run.click();
  await expect(run).toHaveText('Pause');
  await expect(page.locator('[data-said]').first()).toHaveText(
    /^The run plays again from 1\.500 s/,
  );
  await expect(page.getByRole('button', { name: 'Stop taking orders' })).toBeVisible();
});

// The same stop, but the queue hasn't drained: every worker is down, and the orders wait. "Nothing is
// left" beside "13 waiting" would be false, and what carries this run on is a worker, not more orders.
test('with every worker down and orders waiting, the clock stops, says so, and a restart carries on', async ({
  page,
}) => {
  await page.goto('/lab/queue/');
  const run = page.locator('[data-qu-run]');
  const clock = page.locator('[data-qu-clock]');
  await page.locator('label:has(input[name="qu-speed"][value="5"])').click();
  await page.locator('[data-qu-producer]').click();
  await page.locator('[data-qu-crash="0"]').click(); // worker 2 is down at the opening
  await page.locator('[data-qu-crash="2"]').click();
  await run.click();
  const line = page.locator('[data-said]').first();
  await expect(line).toHaveText(
    /^\d+ orders wait and no worker is up, so the clock stops here\. Run plays the run again from 1\.500 s, or restart a worker to carry on\.$/,
    { timeout: 20_000 },
  );
  await expect(run).toHaveText('Run');
  await expect(page.locator('[data-qu-wait]')).toHaveText(/^\d+ waiting/);
  const stopped = Number(/[\d.]+/.exec((await clock.textContent()) ?? '')?.[0]);
  await page.locator('[data-qu-crash="0"]').click();
  await run.click();
  await expect(run).toHaveText('Pause');
  await expect
    .poll(async () => Number(/[\d.]+/.exec((await clock.textContent()) ?? '')?.[0]))
    .toBeGreaterThan(stopped);
});

test('Run on a run standing where the picture told it, with only a setting chosen, plays the story under that setting', async ({
  page,
}) => {
  await page.goto('/lab/cache/');
  await page.getByRole('radio', { name: 'Morning rush', exact: true }).check();
  await page.locator('[data-cl-run]').click();
  await expect
    .poll(async () =>
      Number(/([\d.]+) s/.exec((await page.locator('[data-cl-clock]').textContent()) ?? '')?.[1]),
    )
    .toBeLessThan(5);
  await expect(page.locator('[data-cl-readers]')).toHaveText('Readers, 600 a second');
  await page.locator('[data-cl-run]').click();
});

test('Run after a press of the visitor’s own carries on from where the run stands', async ({
  page,
}) => {
  await page.goto('/lab/cache/');
  await page.locator('[data-cl-flush]').click();
  await page.locator('[data-cl-run]').click();
  await expect
    .poll(async () =>
      Number(/([\d.]+) s/.exec((await page.locator('[data-cl-clock]').textContent()) ?? '')?.[1]),
    )
    .toBeGreaterThan(5);
  await page.locator('[data-cl-run]').click();
});
