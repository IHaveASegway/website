// The Queue Lab's eager script, the only module its page loads before a visitor touches the demo
// (ADR 0020's pattern; within the 5 KB of eager JavaScript every page has). The picture is the
// opening run, drawn at build; the simulation loads on intent, a focus inside the demo, a mouse over
// it, or a press, and a press or a choice made before it arrives is kept and played once it has. A
// touch that only scrolls the page loads nothing, but a visitor who lands here gets the demo running (below).

import { keepChoice, landsRunning, whenSettled } from '../../lib/lab/arrival';

const UNLOADED = 'The demo did not load. Press any control to try again.';

const root = document.getElementById('queue-lab');

if (root) {
  const said = root.querySelector('[data-qu-said]');
  const queued: Element[] = [];
  let ready = false;
  let failed = false;
  let started: Promise<void> | undefined;
  let arrive: (() => void) | undefined;
  const start = () => {
    started ??= import('./app')
      .then((app) => {
        arrive = app.start(root, queued);
      })
      .then(() => {
        ready = true;
        failed = false;
      })
      .catch(() => {
        started = undefined;
        failed = true;
        if (said) said.textContent = UNLOADED;
      });
  };

  root.addEventListener('focusin', () => {
    if (!failed) start();
  });
  root.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch' && !failed) start();
  });
  // A press before the app is ready: kept in order, then played (app.ts reads `queued`).
  root.addEventListener('click', (event) => {
    if (ready) return;
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button');
    if (!control) return;
    // Nothing plays yet, so this Run is a visitor asking for it: it undoes a Pause kept for the tab.
    if (control.matches('[data-qu-run]')) keepChoice(false);
    queued.push(control);
    start();
  });
  // A choice, a radio the browser has already checked: kept too, and played in its turn.
  root.addEventListener('change', (event) => {
    if (ready || !(event.target instanceof Element)) return;
    queued.push(event.target);
    start();
  });
  // A link to a run (#seed-8, with any settings after it: lib/sim/link.ts) is intent enough: it
  // opens that run at once, on load or later.
  const linked = () => /^#seed-\d{1,6}(&|$)/.test(location.hash);
  if (linked()) start();
  addEventListener('hashchange', () => {
    if (linked() && !failed) start();
  });
  // Unless they asked otherwise, a visitor lands on the demo running (ADR 0030): once the page has
  // settled the simulation loads and plays, and a press made before then is theirs to play instead.
  if (landsRunning() && !linked())
    whenSettled(() => {
      start();
      void started?.then(() => {
        if (queued.length === 0) arrive?.();
      });
    });
}

// A module, not a script: its names stay its own, apart from the other labs' boot scripts.
export {};
