// The command menu (design-system.md, "The command menu"): ⌘K or Ctrl+K opens it on every page, at
// once and with no animation, and so do the header's buttons. It is a native <dialog>, which makes
// the page behind it inert, closes on Esc and returns focus to whatever opened it. Its rows are in
// the page already (components/Palette.astro), read from the one nav manifest, so this module
// writes no markup. Focus stays in the input, a combobox, and aria-activedescendant names the
// selected row; typing filters the rows by subsequence over each label and its keywords, and by the
// query whole over a demo's or a post's summary, whose many words would let a subsequence find
// almost anything; it selects the first row that holds the query whole, where there is one. It is one
// module with no imports, so every page loads one file and nothing more (test/scripts.test.ts,
// test/budgets.test.ts). The three pure functions are exported for test/palette.test.ts.

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

/** Text as the menu compares it: lowercase, without accents, so "resume" finds "Résumé". */
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Whether every character of the query appears in the text, in order. Spaces in the query are
 *  ignored, so "copy email" finds "Copy email address" as "cpy" does. */
export function matches(query, text) {
  const wanted = [...fold(query).replace(/\s+/g, '')];
  let found = 0;
  for (const char of fold(text)) if (char === wanted[found]) found += 1;
  return found === wanted.length;
}

/** Whether the query appears in the text as it is typed, its letters together: "bak" in "bakery",
 *  not in "Break". A row found this way is the better match, and Enter goes to the first of them. */
export function contains(query, text) {
  const wanted = fold(query).replace(/\s+/g, ' ').trim();
  return wanted !== '' && fold(text).includes(wanted);
}

function boot() {
  const dialog = document.querySelector('dialog[data-palette]');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return;
  const input = dialog.querySelector('input');
  const options = [...dialog.querySelectorAll('[role="option"]')];
  const groups = [...dialog.querySelectorAll('[role="group"]')];
  const empty = dialog.querySelector('[data-palette-empty]');
  const note = dialog.querySelector('[data-palette-note]');
  const say = dialog.querySelector('[data-palette-say]');
  // Two buttons open it, one shown at a time: the rail's search field, and the header row's keys.
  const openers = [...document.querySelectorAll('[data-palette-open]')];
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
  // its label, the value or the names beside it, and its keywords. A demo's or a post's title is
  // long, so its letters are found word by word, and the title and its summary only whole: across
  // a dozen words a subsequence finds almost anything ("rsm" in "Four locks, none of them closed").
  const found = (option) => option.dataset.find !== undefined;
  const words = (option) => [
    ...(found(option)
      ? (option.textContent ?? '').split(/\s+/)
      : [...option.childNodes].map((node) => node.textContent ?? '')),
    ...(option.dataset.keys ?? '').split(' '),
  ];
  const wholes = (option) =>
    found(option) ? [option.textContent ?? '', option.dataset.find ?? ''] : words(option);

  // The rows that match, the groups that still hold one, and the first match selected, so Enter
  // acts at once. The count is said once typing pauses, not on every key.
  const narrow = () => {
    shown = options.filter((option) => {
      const keep =
        !(forced.matches && option.dataset.act === 'theme') &&
        (words(option).some((word) => word.trim() !== '' && matches(input.value, word)) ||
          wholes(option).some((text) => contains(input.value, text)));
      option.hidden = !keep;
      return keep;
    });
    for (const group of groups) group.hidden = !shown.some((option) => group.contains(option));
    empty.hidden = shown.length > 0;
    note.textContent = '';
    // The first row that holds the query whole, else the first row: a scattered subsequence ("bak"
    // in "Break") never takes Enter from a word that starts the same way.
    const whole = shown.find((option) =>
      wholes(option).some((text) => contains(input.value, text)),
    );
    select(whole ?? shown[0]);
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
    dialog.showModal();
    input.focus();
  };

  // A page or a profile is a place to go, in this tab or, with ⌘ or Ctrl held, a new one. The
  // address is copied while the press that asked for it is still handled, as browsers require; on
  // a refusal the line shows the address to copy by hand. The theme entry presses the toggle, whose
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
    } else if (act === 'copy') {
      const address = option.dataset.copy ?? '';
      const failed = () => tell(`Could not copy. The address is ${address}.`);
      try {
        navigator.clipboard.writeText(address).then(() => tell('Copied'), failed);
      } catch {
        failed();
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

  // A row acts on a click, as on Enter. A click anywhere else in the box, a heading or a line under
  // the rows, does nothing but leave focus where the keys work: in the input. A click outside the
  // box, on the backdrop, closes the menu, but only when the press began there too: a drag that
  // ends outside the box is not a click on the backdrop.
  const outside = (event) => {
    const box = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  };
  dialog.addEventListener('pointerdown', (event) => (pressedOutside = outside(event)));
  dialog.addEventListener('click', (event) => {
    const option = event.target instanceof Element ? event.target.closest('[role="option"]') : null;
    if (option && !option.hidden) {
      select(option);
      run(option, event.metaKey || event.ctrlKey);
    } else if (pressedOutside && outside(event)) {
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
  for (const opener of openers) opener.addEventListener('click', show);
  // A contrast theme turned on while the menu is open takes the theme entry away at once.
  forced.addEventListener('change', () => dialog.open && narrow());
  // Never restored open: a page the browser keeps for Back comes back as it was before the menu.
  addEventListener('pagehide', () => dialog.open && dialog.close());

  // The Print button (pages/about/index.astro) opens the browser's own print, whose dialog also
  // saves a PDF: the site hosts none (content.md, "Résumé"). Bound here, it shows with the menu.
  for (const button of document.querySelectorAll('[data-print]')) {
    button.addEventListener('click', () => print());
  }

  // The buttons name the keys this keyboard has, then show: until here they hold their place unseen.
  // On an Apple keyboard the command key is the drawn one beside the letter (components/Keys.astro).
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  for (const keys of openers.map((opener) => opener.querySelector('[data-keys]'))) {
    if (!keys) continue;
    keys.toggleAttribute('data-mac', mac);
    const text = keys.querySelector('[data-keys-text]');
    if (text) text.textContent = mac ? 'K' : 'Ctrl K';
  }
  document.documentElement.dataset.palette = '';
}

if (typeof document !== 'undefined') boot();
