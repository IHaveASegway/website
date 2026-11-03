// The command menu (design-system.md, "The command menu"): ⌘K or Ctrl+K opens it on every page, at
// once and with no animation, and so do the header's buttons. It is a native <dialog>, which makes
// the page behind it inert, closes on Esc and returns focus to whatever opened it. Its rows are in
// the page already (components/Palette.astro), read from the one nav manifest, so this module
// writes no markup. Focus stays in the input, a combobox, and aria-activedescendant names the
// selected row. Typing ranks the rows (narrowed, below) and selects the best, so Enter does what the
// words asked. It is one module with no imports, so every page loads one file and nothing more
// (test/scripts.test.ts, test/budgets.test.ts). The pure functions are exported for
// test/palette.test.ts.

/** Whether a keydown opens or closes the menu: ⌘K or Ctrl+K, never a bare key (SC 2.1.4), and never
 *  inside a composition, where an input method uses Ctrl+K itself. On a layout whose K key types a
 *  letter outside a to z, the key's place on the keyboard counts. */
export function isToggle(event) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) {
    return false;
  }
  if (event.isComposing || event.keyCode === 229) return false;
  const key = String(event.key ?? '').toLowerCase();
  return key === 'k' || (!/^[a-z]$/.test(key) && event.code === 'KeyK');
}

/** Text as the menu compares it: lowercase, without accents, so "resume" finds "Résumé", and with a
 *  keyboard's apostrophe, so "bakery's" finds "bakery’s". */
const fold = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();

/** Whether every character of the query appears in the text, in order. Spaces in the query are
 *  ignored, so "print pdf" finds "Print or save as PDF" as "prt" does. */
export function matches(query, text) {
  const wanted = [...fold(query).replace(/\s+/g, '')];
  let found = 0;
  for (const char of fold(text)) if (char === wanted[found]) found += 1;
  return found === wanted.length;
}

/**
 * How well a row answers a query, from 0, not at all, to 5. A row's names are its label and its
 * keywords, each on its own, or a long title's words. Its title and its summary count only where the
 * query stands in them whole: across a dozen words a subsequence finds almost anything ("rsm" in
 * "Four loads, none of them counted").
 * 5: its label starts with the query: what a row says beats what it's also called, so "w" is
 * Writing, not Lab for the keyword "work".
 * 4: a name starts with the query, as "essay" does "essays".
 * 3: a name or the title holds it whole, as "save" does "Print or save as PDF".
 * 2: the summary holds it whole.
 * 1: its letters are in a name in order, scattered, as "rsm" in "resume". An empty query is this,
 * for every row.
 */
export function rankOf(query, { names, title = '', summary = '' }) {
  const wanted = fold(query).replace(/\s+/g, ' ').trim();
  const has = (list, test) => wanted && list.some((text) => test(fold(text).trim()));
  const starts = (name) => name.startsWith(wanted);
  const holds = (text) => text.includes(wanted);
  if (has([names[0]], starts)) return 5;
  if (has(names, starts)) return 4;
  if (has([...names, title], holds)) return 3;
  if (has([summary], holds)) return 2;
  return names.some((name) => matches(query, name)) ? 1 : 0;
}

/**
 * What a query leaves of the rows, in their order, and the one Enter should act on, the first of the
 * best. Scattered letters are a fallback: once any row holds the query whole they leave the list, so
 * "bak" never offers "Break".
 */
export function narrowed(query, rows) {
  const ranks = new Map(rows.map((row) => [row, rankOf(query, row)]));
  const top = Math.max(0, ...ranks.values());
  return {
    shown: rows.filter((row) => ranks.get(row) > (top > 1 ? 1 : 0)),
    active: rows.find((row) => ranks.get(row) === top && top > 0),
  };
}

function boot() {
  const dialog = document.querySelector('dialog[data-palette]');
  if (!dialog?.showModal) return;
  const input = dialog.querySelector('input');
  const options = [...dialog.querySelectorAll('[role="option"]')];
  const groups = [...dialog.querySelectorAll('[role="group"]')];
  const empty = dialog.querySelector('[data-palette-empty]');
  const note = dialog.querySelector('[data-palette-note]');
  const say = dialog.querySelector('[data-palette-say]');
  // The top bar's Search opens it.
  const opener = document.querySelector('[data-palette-open]');
  // Forced colors replace both themes, so the theme entry would change nothing there, as the
  // toggle would; CSS hides it, and narrowing leaves it out of the rows the arrows move through.
  const forced = matchMedia('(forced-colors: active)');
  let shown = [];
  let active = null;
  let timer = 0;
  let pressedOutside = false;

  // One line for the eye and one for assistive technology, which is hidden on screen and must sit
  // inside the dialog: the page behind a modal dialog is inert, and an inert region says nothing.
  const tell = (text) => {
    clearTimeout(timer);
    note.textContent = text;
    say.textContent = '';
    timer = setTimeout(() => (say.textContent = text), 50);
  };

  const select = (option) => {
    active?.removeAttribute('aria-selected');
    active = option ?? null;
    if (active) {
      active.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  // What a row is found by, each on its own, so a query's letters cannot be gathered across them:
  // its label, the value or the names beside it, and its keywords; or a lab's or a post's title, word
  // by word and whole, and its summary (rankOf). Its words and keywords also count together, whole,
  // so a term of two words, "decision records", finds its row and the letters still can't scatter.
  const rowOf = (option) => {
    const { keys = '', find: summary } = option.dataset;
    const words = option.textContent;
    const names = summary ? words.split(/\s+/) : [...option.childNodes].map((n) => n.textContent);
    return { option, title: `${words} ${keys}`, summary, names: [...names, ...keys.split(' ')] };
  };

  // The rows that answer, the groups that still hold one, and the best one selected, so Enter acts
  // at once. The count is said once typing pauses, not on every key.
  const narrow = () => {
    const rows = options
      .filter((option) => !(forced.matches && option.dataset.act === 'theme'))
      .map(rowOf);
    const { shown: left, active: best } = narrowed(input.value, rows);
    shown = left.map((row) => row.option);
    for (const option of options) option.hidden = !shown.includes(option);
    for (const group of groups) group.hidden = !shown.some((option) => group.contains(option));
    empty.hidden = shown.length > 0;
    note.textContent = '';
    select(best?.option);
    clearTimeout(timer);
    const count = shown.length === 1 ? '1 result' : `${shown.length} results`;
    timer = setTimeout(() => (say.textContent = shown.length === 0 ? 'No matches' : count), 500);
  };

  const show = () => {
    if (dialog.open) return;
    input.value = '';
    narrow();
    clearTimeout(timer);
    say.textContent = '';
    const root = document.documentElement;
    root.dataset.palette = root.scrollHeight > root.clientHeight ? 'scrolls' : '';
    dialog.showModal();
    input.focus();
  };

  // A page or a profile is a place to go, in this tab or, with ⌘ or Ctrl held, a new one. The theme
  // entry presses the toggle, whose
  // handler (src/scripts/theme.js) is the only code that reads or writes the stored choice, and the
  // print entry presses the page's Print button, once the menu has closed and left the paper.
  const run = (option, newTab) => {
    const { href, act } = option.dataset;
    if (href !== undefined) {
      if (newTab) {
        window.open(href, '_blank', 'noopener');
      } else {
        dialog.close();
        location.assign(href);
      }
    } else if (act === 'theme') {
      document.querySelector('[data-theme-toggle]')?.click();
      const theme = document.documentElement.dataset.theme;
      tell(option.querySelector(`[data-for="${theme}"]`)?.textContent ?? '');
    } else if (act === 'print') {
      dialog.close();
      document.querySelector('[data-print]')?.click();
    }
  };

  input.addEventListener('input', narrow);
  input.addEventListener('keydown', (event) => {
    // An Enter that ends a composition (an input method's) is the composition's, not the menu's.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = shown.length;
      if (count === 0) return;
      const at = shown.indexOf(active);
      const down = event.key === 'ArrowDown';
      select(shown[at < 0 ? (down ? 0 : count - 1) : (at + (down ? 1 : count - 1)) % count]);
    } else if (event.key === 'Enter' && active && !event.repeat) {
      event.preventDefault();
      run(active, event.metaKey || event.ctrlKey);
    }
  });

  // A row acts on a click, as on Enter. The Close button, which a touch screen shows, closes the
  // menu. A click anywhere else in the box, a heading or a line under the rows, does nothing but
  // leave focus where the keys work: in the input. A click outside the box, on the backdrop, closes
  // the menu, but only when the press began there too: a drag that ends outside the box is not a
  // click on the backdrop.
  // The box's rows and lines fill it, so a press on the dialog itself is on its backdrop.
  const outside = (event) => event.target === dialog;
  dialog.addEventListener('pointerdown', (event) => (pressedOutside = outside(event)));
  dialog.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) {
      select(option);
      run(option, event.metaKey || event.ctrlKey);
    } else if (event.target.closest('[data-palette-close]') || (pressedOutside && outside(event))) {
      dialog.close();
    }
    if (dialog.open) input.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (!isToggle(event)) return;
    event.preventDefault();
    if (dialog.open) dialog.close();
    else show();
  });
  opener?.addEventListener('click', show);
  // A contrast theme turned on while the menu is open takes the theme entry away at once.
  forced.addEventListener('change', () => dialog.open && narrow());
  // Never restored open: a page the browser keeps for Back comes back as it was before the menu.
  addEventListener('pagehide', () => dialog.open && dialog.close());

  // The Print button (pages/about/index.astro) opens the browser's own print, whose dialog also
  // saves a PDF: the site hosts none (content.md, "Résumé"). Bound here, it shows with the menu.
  document.querySelector('[data-print]')?.addEventListener('click', () => print());

  // The button names the keys this keyboard has, then shows: until here it holds its place unseen.
  // On an Apple keyboard the command key is the drawn one beside the letter (components/Keys.astro).
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const keys = opener?.querySelector('[data-keys]');
  keys?.toggleAttribute('data-mac', mac);
  const text = keys?.querySelector('[data-keys-text]');
  if (text) text.textContent = mac ? 'K' : 'Ctrl K';
  document.documentElement.dataset.palette = '';
}

if (typeof document !== 'undefined') boot();
