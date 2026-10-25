// Runs the shipped files (vroom-worker.mjs -> vroom-solver.mjs ->
// vroom.mjs -> vroom.wasm) in headless Chromium, in a module Web
// Worker, under a strict hash-free CSP, and checks that every answer
// equals the Node answer from the same files.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright CHROMIUM=/path/to/chrome node test/browser.mjs
//
// Four runs. STRICT is script-src 'self' 'wasm-unsafe-eval'; NO_WASM
// is the same without 'wasm-unsafe-eval'. "worker" is the CSP header
// on the vroom-worker.mjs response; "page" is the header on every
// other response (the page, its script, the modules and the .wasm).
//   strict       page STRICT,  worker STRICT   must pass
//   worker-only  page NO_WASM, worker STRICT   must pass
//   page-only    page STRICT,  worker NO_WASM  must fail
//   no-wasm      page NO_WASM, worker NO_WASM  must fail
// "Pass" means all 8 answers equal Node's and zero CSP violations, so
// the glue needs no 'unsafe-eval'. Together the four show that only
// the worker script's own response needs 'wasm-unsafe-eval': a worker
// takes its CSP from its own response, not from the page.
// Writes test/results/browser.json. Exits 1 on any unexpected result.
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVroom } from '../vroom-solver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
// The site's own Playwright (apps/web) unless PLAYWRIGHT names another; its browsers unless
// CHROMIUM names an executable.
const { chromium } = require(
  process.env.PLAYWRIGHT ??
    createRequire(join(HERE, '../../../apps/web/package.json')).resolve('@playwright/test'),
);
const CHROMIUM = process.env.CHROMIUM;

const TYPES = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};
const STRICT =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'";
const NO_WASM = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'";
const RUNS = [
  { label: 'strict', page: STRICT, worker: STRICT, expect: 'pass' },
  { label: 'worker-only', page: NO_WASM, worker: STRICT, expect: 'pass' },
  { label: 'page-only', page: STRICT, worker: NO_WASM, expect: 'fail' },
  { label: 'no-wasm', page: NO_WASM, worker: NO_WASM, expect: 'fail' },
];

function serve(run) {
  const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT + sep)) return res.writeHead(403).end();
    let st;
    try {
      st = statSync(path);
    } catch {
      return res.writeHead(404).end();
    }
    if (!st.isFile()) return res.writeHead(404).end();
    const isWorker = path === join(ROOT, 'vroom-worker.mjs');
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'content-security-policy': isWorker ? run.worker : run.page,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const strip = (out) => {
  const o = structuredClone(out);
  if (o.summary) delete o.summary.computing_times;
  return JSON.stringify(o);
};

const node = await createVroom();
const browser = await chromium.launch({ executablePath: CHROMIUM });
const report = { chromium: browser.version(), runs: {} };
let ok = true;

for (const run of RUNS) {
  const { label } = run;
  const server = await serve(run);
  const { port } = server.address();
  const page = await browser.newPage();
  const console_ = [];
  page.on('console', (m) => console_.push(`${m.type()}: ${m.text()}`));
  await page.goto(`http://127.0.0.1:${port}/test/browser/index.html`);
  await page.waitForFunction(() => window.__results, null, { timeout: 120_000 });
  const got = await page.evaluate(() => window.__results);
  await page.close();
  server.close();

  const rows = got.results.map((r) => {
    if (r.failed) return { name: r.name, x: r.x, failed: r.failed };
    const text = readFileSync(join(HERE, 'fixtures', `${r.name}.json`), 'utf8');
    const expected = JSON.parse(node.solveJson(text, { explorationLevel: r.x }));
    return {
      name: r.name,
      x: r.x,
      cost: r.output.summary?.cost,
      solveMs: +r.ms.toFixed(1),
      sameAsNode: strip(r.output) === strip(expected),
    };
  });
  const cspErrors = [
    ...got.violations,
    ...console_.filter((c) => /Content Security Policy|CompileError|wasm/i.test(c)),
  ];
  const solved =
    rows.length === 8 && rows.every((r) => r.sameAsNode) && got.violations.length === 0;
  const refused = rows.length > 0 && rows.every((r) => r.failed);
  const asExpected = run.expect === 'pass' ? solved : refused;
  if (!asExpected) ok = false;
  report.runs[label] = {
    page: run.page,
    worker: run.worker,
    expect: run.expect,
    asExpected,
    rows,
    cspErrors,
    console: console_.slice(0, 20),
  };
  console.log(`\n${label}: expected ${run.expect}, ${asExpected ? 'as expected' : 'UNEXPECTED'}`);
  console.log(`  page CSP:   ${run.page}\n  worker CSP: ${run.worker}`);
  for (const r of rows)
    console.log(
      r.failed
        ? `  ${r.name} x=${r.x}  failed: ${r.failed.slice(0, 140)}`
        : `  ${r.name} x=${r.x}  cost ${r.cost}  ${r.solveMs} ms  ${r.sameAsNode ? 'same as Node' : 'DIFFERENT from Node'}`,
    );
  if (cspErrors.length)
    console.log('  CSP/console:', cspErrors.slice(0, 3).join(' | ').slice(0, 300));
}

await browser.close();
mkdirSync(join(HERE, 'results'), { recursive: true });
writeFileSync(join(HERE, 'results', 'browser.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nChromium ${report.chromium}: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
