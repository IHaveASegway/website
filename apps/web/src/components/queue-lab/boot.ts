// The Queue Lab's eager script, the only module its page loads before a visitor touches the demo
// (ADR 0020's pattern; within the 5 KB of eager JavaScript every page has). The picture is the
// opening run, drawn at build; the simulation loads on intent, a focus inside the demo, a mouse over
// it, or a press, and a press or a choice made before it arrives is kept and played once it has. A
// touch that only scrolls the page loads nothing.

const UNLOADED = 'The demo did not load. Press any control to try again.';

const root = document.getElementById('queue-lab');

if (root) {
  const said = root.querySelector('[data-qu-said]');
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
  // A press before the app is ready: kept in order, then played (app.ts reads `queued`).
  root.addEventListener('click', (event) => {
    if (ready) return;
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button');
    if (!control) return;
    queued.push(control);
    start();
  });
  // A choice, a radio the browser has already checked: kept too, and played in its turn.
  root.addEventListener('change', (event) => {
    if (ready || !(event.target instanceof Element)) return;
    queued.push(event.target);
    start();
  });
  // A link to a run (#seed-8) is intent enough: it opens that run at once.
  if (/^#seed-\d{1,6}$/.test(location.hash)) start();
}

// A module, not a script: its names stay its own, apart from the other labs' boot scripts.
export {};
