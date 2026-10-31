// The Backfill Lab's eager script, the only module its page loads before a visitor touches the
// demo (ADR 0026, as ADR 0020 for the Raft Lab; within the 5 KB of eager JavaScript every page
// has). The picture is the opening run, drawn at build; the simulation loads on intent, a focus
// inside the demo, a mouse over it, or a press, and a press made before it arrives is kept and
// played once it has. A touch that only scrolls the page loads nothing.

const UNLOADED = 'The demo did not load. Press any control to try again.';

const root = document.getElementById('backfill-lab');

if (root) {
  const said = root.querySelector('[data-bf-said]');
  const queued: Element[] = [];
  let ready = false;
  let failed = false;
  let started: Promise<void> | undefined;
  const start = () => {
    started ??= import('./app')
      .then((app) => app.start(root, queued))
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
  // A press before the app is ready: kept in order, then played (app.ts reads `queued`). A choice
  // between radio buttons arrives as a change, which the browser has already made.
  root.addEventListener('click', (event) => {
    if (ready) return;
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button');
    if (!control) return;
    queued.push(control);
    start();
  });
  root.addEventListener('change', (event) => {
    if (ready || !(event.target instanceof Element)) return;
    queued.push(event.target);
    start();
  });
  // A link to a week (#seed-12, with any settings after it: lib/sim/link.ts) is intent enough: it
  // opens that week at once, on load or later.
  const linked = () => /^#seed-\d{1,6}(&|$)/.test(location.hash);
  if (linked()) start();
  addEventListener('hashchange', () => {
    if (linked() && !failed) start();
  });
}

// A module, so its names are its own: as a plain script it would share the global scope with the
// Raft Lab's boot.ts, and the type check refuses two `root`s there.
export {};
