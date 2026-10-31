import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, pages } from './expected';

// WCAG 2.2 AA (design-system.md, "Accessibility rules"). axe finds part of what matters, about 57%
// of issues in Deque's own data; the keyboard and screen-reader pass in the pull request template
// covers the rest.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ROUTES = [...pages(), NOT_FOUND_PAGE];
type Media = Parameters<Page['emulateMedia']>[0] & {};
const MEDIA: Record<string, Media> = {
  dark: { colorScheme: 'dark' },
  light: { colorScheme: 'light' },
  'more contrast': { colorScheme: 'dark', contrast: 'more' },
  'forced colors': { colorScheme: 'light', forcedColors: 'active' },
};

/** A theme chosen in this tab, the opposite of the OS's: the toggle's two chosen states. */
const STORED: Record<string, { media: Media; theme: 'light' | 'dark' }> = {
  'dark OS, light stored': { media: { colorScheme: 'dark' }, theme: 'light' },
  'light OS, dark stored': { media: { colorScheme: 'light' }, theme: 'dark' },
};

for (const path of ROUTES) {
  for (const [name, media] of Object.entries(MEDIA)) {
    test(`axe finds no violation on ${path}, ${name}`, async ({ page }) => {
      await page.emulateMedia(media);
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations).toEqual([]);
    });
  }
  for (const [name, { media, theme }] of Object.entries(STORED)) {
    test(`axe finds no violation on ${path}, ${name}`, async ({ page }) => {
      await page.emulateMedia(media);
      await page.addInitScript((choice) => sessionStorage.setItem('theme', choice), theme);
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

// The fallback fonts are wider than a condensed face would be if they were not fitted, and the
// overflow PR 2's first CI run found happened in a fallback, so the check runs without the web
// fonts too.
for (const fonts of ['loaded', 'blocked'] as const) {
  test(`no sideways scrolling at 320 px, web fonts ${fonts} (SC 1.4.10)`, async ({ page }) => {
    if (fonts === 'blocked') await page.route('**/*.woff2', (route) => route.abort());
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ROUTES) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}

// A larger default text size (SC 1.4.4 with SC 1.4.10): a reader who sets the browser's text to
// 24 or 32 px, 150% and 200% of the usual 16, on a phone. Chromium's own setting, through the
// DevTools Protocol, so rem and the media queries grow as they do for that reader (a full-page
// screenshot resets it). Nothing may scroll sideways, no button's label or icon may leave its border,
// no text in the header or the footer may cross the frame's edge, and no word of the name may break
// across lines, on Home's poster or in the header of every other page. The build of 2026-10-24 broke the name as "Peterso / n", put the LinkedIn arrow
// outside its button, and scrolled 65 px sideways at 32 px and 320 px.
const LARGER_TEXT = [24, 32] as const;

interface Fault {
  readonly where: string;
  readonly what: string;
}

/** Everything a larger text size broke on the page. Runs in the page. */
function largeTextFaults(): Fault[] {
  const faults: Fault[] = [];
  // Shown on screen: not inside an element that is not displayed or is clipped away, the way
  // a name only assistive technology reads is hidden.
  const shown = (node: Node) => {
    for (let at = node instanceof Element ? node : node.parentElement; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.display === 'none' || style.visibility === 'hidden' || style.clipPath !== 'none')
        return false;
    }
    return true;
  };
  const rects = (range: Range) => [...range.getClientRects()].filter((r) => r.width && r.height);
  const texts = (root: Node) => {
    const found: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node instanceof Text && node.data.trim() && shown(node)) found.push(node);
    return found;
  };
  const boxes = (node: Text) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return rects(range);
  };
  const name = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

  const overflow = document.documentElement.scrollWidth - innerWidth;
  if (overflow > 0) faults.push({ where: 'page', what: `scrolls ${overflow} px sideways` });

  for (const button of document.querySelectorAll('a.btn, button')) {
    if (!button.checkVisibility()) continue;
    const box = button.getBoundingClientRect();
    const icons = [...button.querySelectorAll('svg')].filter(shown);
    const parts = [
      ...texts(button).flatMap(boxes),
      ...icons.map((icon) => icon.getBoundingClientRect()),
    ];
    const outside = (r: DOMRect) =>
      r.left < box.left - 0.5 ||
      r.right > box.right + 0.5 ||
      r.top < box.top - 0.5 ||
      r.bottom > box.bottom + 0.5;
    if (parts.some(outside)) faults.push({ where: name(button), what: 'content outside its box' });
  }

  for (const region of document.querySelectorAll('header, footer')) {
    const frame = region.closest('.frame') ?? region;
    const style = getComputedStyle(frame);
    const edge = frame.getBoundingClientRect();
    const [left, right] = [
      edge.left + parseFloat(style.paddingLeft),
      edge.right - parseFloat(style.paddingRight),
    ];
    // The poster name's box starts its side bearing (--bearing, in em) left of the frame, so the
    // stem of its first letter lines up with the frame's edge (design-system.md, "The poster
    // setting"). The résumé sets that poster in its article's <header>: the bearing, and no more,
    // is not past the frame.
    const hang = (text: Text) => {
      const name = text.parentElement?.closest('.hero-name');
      if (!name) return 0;
      const style = getComputedStyle(name);
      const bearing = /^\s*([\d.]+)em\s*$/.exec(style.getPropertyValue('--bearing'))?.[1];
      return bearing ? Number(bearing) * parseFloat(style.fontSize) : 0;
    };
    const past = texts(region).filter((text) =>
      boxes(text).some((r) => r.left < left - hang(text) - 0.5 || r.right > right + 0.5),
    );
    for (const text of past)
      faults.push({ where: region.localName, what: `"${text.data.trim()}" past the frame` });
  }

  for (const heading of document.querySelectorAll('.hero-name, .about-name, .wordmark')) {
    for (const text of texts(heading)) {
      for (const word of text.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        const lines = new Set(rects(range).map((r) => Math.round(r.top)));
        if (lines.size > 1)
          faults.push({ where: 'name', what: `"${word[0]}" breaks across ${lines.size} lines` });
      }
    }
  }
  return faults;
}

/** The browser's default text size, as a reader sets it in Chromium's settings. */
async function setDefaultTextSize(page: Page, px: number) {
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('Page.setFontSizes', {
    fontSizes: { standard: px, fixed: Math.round((px * 13) / 16) },
  });
}

for (const size of LARGER_TEXT) {
  for (const width of [320, 390]) {
    test(`at ${size} px default text and ${width} px wide, nothing scrolls sideways, leaves its box or breaks a word (SC 1.4.4, 1.4.10)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await setDefaultTextSize(page, size);
      for (const path of ROUTES) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const root = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
        expect(root, `${path}: the setting applies`).toBe(`${size}px`);
        expect(await page.evaluate(largeTextFaults), path).toEqual([]);
      }
    });
  }
}

test('known answers: the larger-text check names each fault, and passes a name only a reader hears', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.setContent(
    [
      '<body style="margin: 0; font: 20px monospace">',
      '<h1 class="hero-name" style="margin: 0; font-size: 20px; overflow-wrap: break-word">Joseph Peterson</h1>',
      '<a class="btn" href="/x" style="display: inline-flex; white-space: nowrap; font-size: 16px">LinkedIn ↗</a>',
      '<button type="button" style="width: 44px; height: 44px"><span style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap">A name only a reader hears</span></button>',
      '<div class="frame"><footer style="white-space: nowrap; font-size: 16px">hello@ihaveasegway.com</footer></div>',
      '</body>',
    ].join(''),
  );
  // Each box is sized from the face this machine draws, never from an assumed character width:
  // CI's monospace face is narrower than 0.6em, and there "Peterson" fit a fixed 90 px box.
  const measured = await page.evaluate(() => {
    const width = (element: HTMLElement, words: string) => {
      const probe = element.appendChild(document.createElement('span'));
      probe.style.whiteSpace = 'nowrap';
      probe.textContent = words;
      const drawn = probe.getBoundingClientRect().width;
      probe.remove();
      return drawn;
    };
    const [heading, button, frame, footer] = ['.hero-name', '.btn', '.frame', 'footer'].map(
      (selector) => document.querySelector<HTMLElement>(selector),
    );
    if (!heading || !button || !frame || !footer) throw new Error('the fixture lost an element');
    const [joseph, peterson] = [width(heading, 'Joseph'), width(heading, 'Peterson')];
    heading.style.width = `${(joseph + peterson) / 2}px`; // "Joseph" fits, "Peterson" does not
    button.style.width = `${width(button, 'LinkedIn ↗') / 2}px`;
    // Half the address fits the frame, and all of it the page, so the page does not scroll.
    const email = width(footer, 'hello@ihaveasegway.com');
    frame.style.padding = `0 ${innerWidth - email / 2}px 0 0`;
    return { joseph, peterson, email };
  });
  expect(measured.peterson - measured.joseph, '"Peterson" is wider than "Joseph"').toBeGreaterThan(
    4,
  );
  expect(measured.email, 'the address fits the page').toBeLessThan(320);
  const faults = await page.evaluate(largeTextFaults);
  expect(faults.map(({ where, what }) => `${where}: ${what}`)).toEqual([
    'LinkedIn ↗: content outside its box',
    'footer: "hello@ihaveasegway.com" past the frame',
    'name: "Peterson" breaks across 2 lines',
  ]);
  await page.evaluate(() => {
    const wide = document.body.appendChild(document.createElement('div'));
    wide.style.width = '400px';
    wide.style.height = '1px';
  });
  expect((await page.evaluate(largeTextFaults))[0]?.what).toBe('scrolls 80 px sideways');
});

// The résumé's head is Home's poster inside an article's <header>, so the frame rule reads its name,
// which starts its side bearing left of the frame by design. The known answer: the bearing passes,
// and a box set further left than the bearing is still past the frame.
test('known answers: the poster name may hang its side bearing past the frame, and no further', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const view = (margin: string) =>
    page.setContent(
      '<body style="margin: 0; font: 20px monospace"><div class="frame" style="padding: 0 40px">' +
        '<header><h1 class="hero-name" style="--bearing: 0.055em; ' +
        `margin: 0 0 0 ${margin}; font-size: 40px">Joseph</h1></header></div></body>`,
    );
  await view('calc(var(--bearing) * -1)');
  expect(await page.evaluate(largeTextFaults)).toEqual([]);
  await view('-0.25em');
  expect(await page.evaluate(largeTextFaults)).toEqual([
    { where: 'header', what: '"Joseph" past the frame' },
  ]);
});

// The skip link (SC 2.4.1), focused, covers the header's whole row, so nothing in the header shows
// around it in part. At 2026-10-24's build it covered most of the name in the 404's header and left
// the last letters showing beside it.
/** What the focused skip link covers in part, or why it is not there to cover anything: the
 *  header's words and icons, as drawn, not the boxes around them. Runs in the page. */
function partlyCovered(): string[] {
  const link = document.activeElement;
  if (!(link instanceof HTMLElement) || !link.matches('.skip-link')) return ['not focused'];
  const cover = link.getBoundingClientRect();
  if (cover.top < 0 || cover.bottom > innerHeight || !cover.height) return ['off screen'];
  const header = document.querySelector('header');
  if (!header) return [];
  const clipped = (node: Node) => {
    for (let at = node.parentElement; at; at = at.parentElement)
      if (getComputedStyle(at).clipPath !== 'none') return true;
    return false;
  };
  const drawn: { what: string; boxes: DOMRect[] }[] = [];
  const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const words = node.textContent?.trim() ?? '';
    if (!words || clipped(node)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    drawn.push({ what: words, boxes: [...range.getClientRects()] });
  }
  for (const icon of header.querySelectorAll('svg'))
    if (icon.checkVisibility()) drawn.push({ what: 'icon', boxes: [icon.getBoundingClientRect()] });
  const area = (r: DOMRect) => r.width * r.height;
  const overlap = (r: DOMRect) =>
    Math.max(0, Math.min(r.right, cover.right) - Math.max(r.left, cover.left)) *
    Math.max(0, Math.min(r.bottom, cover.bottom) - Math.max(r.top, cover.top));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return drawn
    .filter(({ boxes }) => {
      const covered = sum(boxes.map(overlap));
      return covered > 0.5 && covered < sum(boxes.map(area)) - 0.5;
    })
    .map(({ what }) => what);
}

const SKIP_VIEWS = [
  { width: 390, size: 16 },
  { width: 1440, size: 16 },
  { width: 320, size: 32 },
] as const;

for (const { width, size } of SKIP_VIEWS) {
  test(`the focused skip link covers the header's row cleanly, ${width} px wide at ${size} px text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    if (size !== 16) await setDefaultTextSize(page, size);
    for (const path of ROUTES) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const root = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
      expect(root, `${path}: the text size applies`).toBe(`${size}px`);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(partlyCovered), path).toEqual([]);
    }
  });
}

test('known answers: the cover check names what shows in part, and passes what is hidden whole', async ({
  page,
}) => {
  // Monospace, so the name is 15 × 9.6 = 144 px wide on any machine.
  const view = (cover: number) =>
    page.setContent(
      '<body style="margin: 0; font: 16px monospace">' +
        `<a class="skip-link" href="#m" style="position: absolute; top: 0; left: 0; width: ${cover}px; height: 40px">Skip</a>` +
        '<header><a href="/" style="white-space: nowrap">Joseph Peterson</a></header></body>',
    );
  await view(100);
  await page.focus('.skip-link');
  expect(await page.evaluate(partlyCovered)).toEqual(['Joseph Peterson']);
  await view(400);
  await page.focus('.skip-link');
  expect(await page.evaluate(partlyCovered)).toEqual([]);
  await page.focus('header a');
  expect(await page.evaluate(partlyCovered)).toEqual(['not focused']);
});

// Selected text (design-system.md, "Measured contrast"). A browser paints a selection's fill over
// the face's own height, ascent to descent, one line at a time, each over the line before it. Where
// a block sets its lines closer than that, as display type does (0.86 for the name, 1.02 to 1.2 for
// titles), a fill would hide the foot of the line above: on the first fix of 2026-10-25, with the
// name selected, "Joseph" read as "Iosenh" and the 404's "Page" as "Paqe". So text set that close
// has a selection with no fill, only a color (global.css).
interface Selected {
  /** Text in a block whose lines are closer together than the face is tall. */
  readonly close: number;
  /** Of those, each whose selection still paints a fill, with the fill. */
  readonly filled: string[];
}

/** Text whose selection fill would cover part of the line above it. Runs in the page. */
function selectionFills(): Selected {
  const filled: string[] = [];
  let close = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    const at = (node.nodeValue ?? '').search(/\S/);
    if (!element || at < 0 || !element.checkVisibility()) continue;
    // The face's height: what one character's box spans, ascent to descent.
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    const height = range.getClientRects()[0]?.height ?? 0;
    // The distance between its lines: the line height of the block the text flows in.
    let block: Element = element;
    while (['inline', 'contents'].includes(getComputedStyle(block).display) && block.parentElement)
      block = block.parentElement;
    const pitch = parseFloat(getComputedStyle(block).lineHeight); // "normal" spaces by the face
    if (!(height > pitch + 0.5)) continue;
    close++;
    const fill = getComputedStyle(element, '::selection').backgroundColor;
    if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent')
      filled.push(`"${(node.nodeValue ?? '').trim().slice(0, 40)}": ${fill}`);
  }
  return { close, filled };
}

for (const width of [390, 1440]) {
  test(`selected text set closer than its face is tall has no fill, ${width} px wide`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ROUTES) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const { close, filled } = await page.evaluate(selectionFills);
      // Every page sets a title or the name that close, so the check always has text to read.
      expect(close, `${path}: display type found`).toBeGreaterThan(0);
      expect(filled, path).toEqual([]);
    }
  });
}

test('known answers: the selection check names close lines with a fill, and passes no fill or open lines', async ({
  page,
}) => {
  await page.setContent(
    [
      '<style>::selection { background-color: rgb(200, 100, 0); color: white }',
      '.clear::selection, .clear *::selection { background-color: transparent; color: rgb(200, 100, 0) }</style>',
      '<body style="margin: 0; font: 40px monospace">',
      '<h1 style="line-height: 0.8">Filled</h1>',
      '<h1 class="clear" style="line-height: 0.8">Clear</h1>',
      '<h2 style="line-height: 0.8"><a href="/a/">Inner</a></h2>',
      '<h2 class="clear" style="line-height: 0.8"><a href="/b/">Inherited</a></h2>',
      '<p style="line-height: 2">Open <sup style="line-height: 0">1</sup></p>',
      '</body>',
    ].join(''),
  );
  expect(await page.evaluate(selectionFills)).toEqual({
    close: 4,
    filled: ['"Filled": rgb(200, 100, 0)', '"Inner": rgb(200, 100, 0)'],
  });
});

// Target size (design-system.md, "Accessibility rules"). axe's target-size rule passes a small
// target through SC 2.5.8's spacing exception, which is how 19 px footer links went unnoticed; this
// holds the site's own rule instead, at a phone's width. Every link and button is at least 24 × 24
// px, unless it sits in a sentence (the SC's inline exception), and the targets the house rule
// names are 44 px tall (min-height: 2.75rem): buttons, nav links and the footer's links.
const HOUSE_TARGETS = 'button, .btn, nav a, footer li a';

interface Miss {
  readonly target: string;
  readonly size: string;
  readonly rule: '44 px tall' | '24 × 24 px';
}

/** Every visible link and button smaller than its rule allows. Runs in the page. */
function undersized(house: string): Miss[] {
  const words = (element: Element | null) =>
    (element instanceof HTMLElement ? element.innerText : '').replace(/\s+/g, ' ').trim();
  // In a sentence: drawn inline, inside a block that holds other words too.
  const inSentence = (element: Element) => {
    if (getComputedStyle(element).display !== 'inline') return false;
    let block = element.parentElement;
    while (block && getComputedStyle(block).display === 'inline') block = block.parentElement;
    return words(block).length > words(element).length;
  };
  const misses: Miss[] = [];
  for (const element of document.querySelectorAll('a[href], button')) {
    if (!element.checkVisibility()) continue;
    const rect = element.getBoundingClientRect();
    const tenth = (px: number) => Math.round(px * 10) / 10;
    const [width, height] = [tenth(rect.width), tenth(rect.height)];
    const found = { target: words(element), size: `${width} × ${height} px` };
    if (element.matches(house) && height < 44) misses.push({ ...found, rule: '44 px tall' });
    if (!inSentence(element) && (width < 24 || height < 24))
      misses.push({ ...found, rule: '24 × 24 px' });
  }
  return misses;
}

test('every link and button at 390 px meets its target size (SC 2.5.8 and the 44 px rule)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ROUTES) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(undersized, HOUSE_TARGETS), path).toEqual([]);
  }
});

test('known answers: the target check names a short list link and a small button, and passes a link in a sentence', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    [
      '<nav><a href="/a/" style="display: inline-flex; min-height: 44px; padding: 0 8px">Tall</a></nav>',
      '<p>A sentence with <a href="/b/">a link</a> in it.</p>',
      '<a href="/c/" style="display: block; line-height: 30px">Block</a>',
      '<footer><ul><li><a href="/d/">Short</a></li></ul></footer>',
      '<button type="button" style="width: 20px; height: 20px; padding: 0">x</button>',
    ].join(''),
  );
  const misses = await page.evaluate(undersized, HOUSE_TARGETS);
  expect(misses.map(({ target, rule }) => `${target}: ${rule}`)).toEqual([
    'Short: 44 px tall',
    'Short: 24 × 24 px',
    'x: 44 px tall',
    'x: 24 × 24 px',
  ]);
});

/**
 * How many times Tab stops on a page: each visible link, button and control, except that a group
 * of radio buttons (one name) is one stop, as browsers move through it with the arrow keys.
 * Runs in the page.
 */
function tabStops(): number {
  const groups = new Set<string>();
  return [
    ...document.querySelectorAll<HTMLElement & { disabled?: boolean }>(
      'a[href], button, input, select, textarea, [tabindex]',
    ),
  ].filter((element) => {
    // visibility: hidden counts too: a button that holds its place unseen until its script runs
    // (the command menu's, Home's motion button) is no Tab stop until then.
    if (
      element.tabIndex < 0 ||
      element.disabled ||
      !element.checkVisibility({ visibilityProperty: true })
    )
      return false;
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      if (groups.has(element.name)) return false;
      groups.add(element.name);
    }
    return true;
  }).length;
}

test('known answer: a radio group is one Tab stop', async ({ page }) => {
  await page.setContent(
    [
      '<a href="/a/">A</a>',
      '<label><input type="radio" name="day" checked> One</label>',
      '<label><input type="radio" name="day"> Two</label>',
      '<label><input type="radio" name="vans"> 1</label>',
      '<label><input type="radio" name="vans"> 2</label>',
      '<button type="button">Go</button>',
    ].join(''),
  );
  expect(await page.evaluate(tabStops)).toBe(4);
  const reached: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 20) ?? ''));
  }
  expect(reached.every((html) => html !== '' && !html.startsWith('<body'))).toBe(true);
});

test('every focusable element shows a visible outline from the keyboard (SC 2.4.7)', async ({
  page,
}) => {
  for (const path of ROUTES) {
    await page.goto(path);
    // Once the page's scripts have shown what they show: Home's motion button appears when its
    // module has loaded, after the page has.
    await page.waitForLoadState('networkidle');
    // Only what Tab reaches: a negative tabindex (a skip link's target, often <main tabindex="-1">),
    // a disabled control or a hidden one is focusable by script but never by Tab, and a radio
    // group is one stop (the Route Lab's day and vans).
    const count = await page.evaluate(tabStops);
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return null;
        // A choice drawn as a push-button rings the whole button, the label it stands in, not the
        // 10 px lamp its radio is drawn as (route-lab.css, ADR 0025); every other control rings
        // itself.
        const own = getComputedStyle(element);
        const label = element.closest('label');
        const style = own.outlineStyle === 'none' && label ? getComputedStyle(label) : own;
        return {
          name: element.textContent?.trim() || label?.textContent?.trim(),
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
        };
      });
      expect(focus, `${path}: Tab ${i + 1} reaches an element`).not.toBeNull();
      expect(focus?.style, `${path}: ${focus?.name}`).not.toBe('none');
      expect(focus?.width, `${path}: ${focus?.name}`).toBeGreaterThanOrEqual(2);
    }
  }
});
