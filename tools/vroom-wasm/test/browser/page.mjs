// Runs in the test page: starts vroom-worker.mjs as a module
// worker, sends each fixture, and leaves the answers on
// window.__results for test/browser.mjs to read.
const CASES = ['03-vrptw-25x3', '04-shipments-breaks', 'bench-25x3', 'bench-60x4'];
const violations = [];
document.addEventListener('securitypolicyviolation', (e) =>
  violations.push(`${e.violatedDirective} ${e.blockedURI}`),
);

const t0 = performance.now();
const worker = new Worker(new URL('../../vroom-worker.mjs', import.meta.url), { type: 'module' });
const pending = new Map();
worker.onmessage = ({ data }) => {
  pending.get(data.id)(data);
  pending.delete(data.id);
};
worker.onerror = (e) => {
  for (const resolve of pending.values()) resolve({ failed: `worker error: ${e.message}` });
  pending.clear();
};
const ask = (id, input, options) =>
  new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, input, options });
  });

const results = [];
let id = 0;
for (const name of CASES) {
  const input = await (await fetch(`../fixtures/${name}.json`)).json();
  for (const x of [0, 5]) {
    const reply = await ask(++id, input, { explorationLevel: x });
    results.push({ name, x, ...reply, sinceStartMs: performance.now() - t0 });
    if (reply.failed) break;
  }
  if (results.at(-1).failed) break;
}
window.__results = { results, violations, userAgent: navigator.userAgent };
document.getElementById('status').textContent = 'done';
