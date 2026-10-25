// Proves the WebAssembly build is the same solver as native VROOM:
// for every fixture and every exploration level 0..5, the wasm output
// must equal a native CLI's output (`vroom -t 1 -x N`) once
// summary.computing_times (wall-clock timings) is removed. Error
// inputs must return the same error object.
//
//   VROOM_NATIVE=/path/to/vroom LABEL=gcc node test/verify.mjs
//   VROOM_DIR=/other/build ...   test another build's vroom.mjs/.wasm
//   SKIP_TIMEOUT_CHECK=1          for builds too slow for a 250 ms limit
//   SANITIZER=1                   for the SANITIZE=1 build: collect its
//                                 reports; fail on any AddressSanitizer
//                                 report or any UBSan site in a file the
//                                 patches touch; list the others
//
// Two checks per case:
//   exact      the whole output, byte for byte
//   unordered  the same, with the top-level "unassigned" list sorted
//              by id first. VROOM builds that list by iterating a
//              std::unordered_set (src/utils/helpers.cpp), whose order
//              is up to the C++ standard library: libstdc++ (g++) and
//              libc++ (clang, Emscripten) list the same jobs in a
//              different order.
// Exits 1 if any "unordered" check fails, or, with EXACT=1, if any
// "exact" check fails (use EXACT=1 against a clang/libc++ build).
// Writes test/results/verify-<LABEL>.json.
//
// Native VROOM is not deterministic even with -t 1: it still starts
// one thread per search and they queue on a semaphore in whatever
// order the OS schedules them, and when two searches reach equally
// good solutions the first one to finish wins. The wasm build runs
// the searches in rank order, so it always gives the same answer. So
// each case runs the native CLI up to TRIES times (default 20) and
// passes when one native run matches; "nativeRuns" records how many
// it took.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const NATIVE = process.env.VROOM_NATIVE ?? '/tmp/vroom-wasm-build/vroom-native/bin/vroom';
const LABEL = process.env.LABEL ?? 'native';
const EXACT = process.env.EXACT === '1';
const TRIES = Number(process.env.TRIES ?? 20);
const LEVELS = [0, 1, 2, 3, 4, 5];
const DIR = process.env.VROOM_DIR ?? join(HERE, '..');
const { createVroom } = await import(pathToFileURL(join(DIR, 'vroom-solver.mjs')).href);

function normalise(text, { sortUnassigned = false } = {}) {
  const out = JSON.parse(text);
  if (out.summary) delete out.summary.computing_times;
  if (sortUnassigned && out.unassigned) out.unassigned.sort((a, b) => a.id - b.id);
  return JSON.stringify(out);
}

function native(file, args) {
  const r = spawnSync(NATIVE, [...args, '-i', file], { encoding: 'utf8' });
  if (r.error) throw r.error;
  // The CLI prints the JSON on stdout (the error text goes to stderr).
  return r.stdout.trim();
}

const SANITIZER = process.env.SANITIZER === '1';
const sanitizerLines = [];
const vroom = await createVroom(SANITIZER ? { printErr: (line) => sanitizerLines.push(line) } : {});
const nativeVersion = spawnSync(NATIVE, ['-v'], { encoding: 'utf8' }).stdout.trim();
console.log(`wasm ${vroom.version} (${DIR})  native ${nativeVersion} (${NATIVE})`);
if (`vroom ${vroom.version}` !== nativeVersion) {
  console.error('version mismatch');
  process.exit(1);
}

const results = [];
let failures = 0;
let exactDiffs = 0;
let unorderedOnly = 0;

for (const name of readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const file = join(FIXTURES, name);
  const text = readFileSync(file, 'utf8');
  const isError = name.startsWith('err-');
  const isBig = name.startsWith('big-');
  for (const x of isError ? [5] : isBig ? [0] : LEVELS) {
    const wText = vroom.solveJson(text, { explorationLevel: x });
    if (
      vroom.solveJson(text, { explorationLevel: x }).replace(/"computing_times":\{[^}]*\}/, '') !==
      wText.replace(/"computing_times":\{[^}]*\}/, '')
    ) {
      throw new Error(`wasm gave two different answers for ${name} x=${x}`);
    }
    const w = normalise(wText, { sortUnassigned: true });
    let nText, exact, unordered, n;
    let nativeRuns = 0;
    do {
      nText = native(file, ['-t', '1', '-x', String(x)]);
      nativeRuns++;
      exact = normalise(nText) === normalise(wText);
      n = normalise(nText, { sortUnassigned: true });
      unordered = n === w;
    } while (!(EXACT ? exact : unordered) && nativeRuns < TRIES);
    if (!exact) exactDiffs++;
    if (!exact && unordered) unorderedOnly++;
    const same = EXACT ? exact : unordered;
    if (!same) failures++;
    const out = JSON.parse(w);
    const row = {
      fixture: name,
      x,
      exact,
      unordered,
      nativeRuns,
      code: out.code,
      ...(out.code === 0
        ? {
            cost: out.summary.cost,
            routes: out.summary.routes,
            unassigned: out.summary.unassigned,
            stopsPerRoute: out.routes.map(
              (r) => r.steps.filter((s) => s.type !== 'start' && s.type !== 'end').length,
            ),
          }
        : { error: out.error }),
    };
    // Informational: native with 4 threads at the default level. VROOM's
    // parallel searches can finish in any order, so this may differ.
    if (x === 5 && !isError && !isBig) {
      row.sameAsNative4Threads =
        normalise(native(file, ['-t', '4', '-x', '5']), { sortUnassigned: true }) === w;
    }
    results.push(row);
    console.log(
      `${exact ? 'EXACT    ' : unordered ? 'UNORDERED' : 'DIFF     '}  ${name.padEnd(28)} x=${x}  ` +
        (out.code === 0
          ? `cost ${out.summary.cost}  routes ${out.summary.routes}  unassigned ${out.summary.unassigned}` +
            (nativeRuns > 1 ? `  (native matched on run ${nativeRuns})` : '') +
            (row.sameAsNative4Threads === undefined
              ? ''
              : `  (-t 4: ${row.sameAsNative4Threads ? 'same' : 'differs'})`)
          : `code ${out.code}: ${out.error}`),
    );
    if (!same) {
      console.log('  native:', n.slice(0, 300));
      console.log('  wasm:  ', w.slice(0, 300));
    }
  }
}

// A time limit (CLI -l) must be honoured: VROOM splits it across its
// searches and returns the best solution found so far.
let timeoutCheck;
if (process.env.SKIP_TIMEOUT_CHECK !== '1') {
  const text = readFileSync(join(FIXTURES, 'bench-60x4.json'), 'utf8');
  const start = performance.now();
  const out = JSON.parse(vroom.solveJson(text, { explorationLevel: 5, timeoutMs: 250 }));
  const ms = performance.now() - start;
  const ok = out.code === 0 && ms < 750;
  if (!ok) failures++;
  timeoutCheck = {
    fixture: 'bench-60x4.json',
    x: 5,
    timeoutMs: 250,
    wallMs: Math.round(ms),
    code: out.code,
    cost: out.summary?.cost,
    ok,
  };
  console.log(
    `${ok ? 'OK       ' : 'FAILED   '}  bench-60x4.json with timeoutMs 250: ${Math.round(ms)} ms wall, code ${out.code}, cost ${out.summary?.cost}`,
  );
}

let sanitizer;
if (SANITIZER) {
  // Files the three patches and the entry point add or change.
  const touched = [
    'problems/vrp.h',
    'structures/vroom/tw_route.cpp',
    'structures/vroom/input/input.cpp',
    'problems/tsp/heuristics/local_search.cpp',
    'algorithms/validation/check.cpp',
    'routing/wrapper.h',
    'utils/thread_compat.h',
    'vroom_wasm.cpp',
  ];
  const asan = sanitizerLines.filter((l) =>
    /AddressSanitizer|stack overflow|Stack overflow/i.test(l),
  );
  const ubsan = [...new Set(sanitizerLines.filter((l) => l.includes('runtime error:')))];
  const inTouched = ubsan.filter((l) =>
    touched.some((t) => l.replace(/^\.\//, '').startsWith(t + ':')),
  );
  sanitizer = { asanReports: asan.length, ubsanSites: ubsan, ubsanSitesInPatchedFiles: inTouched };
  if (asan.length || inTouched.length) failures++;
  console.log(`\nAddressSanitizer reports: ${asan.length}`);
  console.log(`UBSan sites hit: ${ubsan.length} (in patched files: ${inTouched.length})`);
  for (const l of ubsan) console.log(`  ${l}`);
}

mkdirSync(join(HERE, 'results'), { recursive: true });
writeFileSync(
  join(HERE, 'results', `verify-${LABEL}.json`),
  JSON.stringify(
    {
      wasm: vroom.version,
      native: nativeVersion,
      reference: LABEL,
      mode: EXACT ? 'exact' : 'unordered',
      failures,
      exactDiffs,
      unorderedOnly,
      timeoutCheck,
      sanitizer,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `\n${LABEL}: ${results.length} comparisons, ${results.length - exactDiffs} byte-identical, ` +
    `${unorderedOnly} differing only in unassigned order` +
    (failures ? `, ${failures} FAILED (${EXACT ? 'exact' : 'unordered'} mode)` : ', 0 failed'),
);
process.exit(failures === 0 ? 0 : 1);
