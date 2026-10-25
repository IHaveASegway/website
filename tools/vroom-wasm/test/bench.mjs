// Solve-time benchmark, Node.
//
//   node test/bench.mjs [DIR_WITH_vroom-solver.mjs] [--native PATH]...
//
// For bench-25x3 and bench-60x4 at exploration levels 0..5: one
// warm-up solve, then RUNS timed solves; reports the median of
// (a) wall time around solveJson, which includes copying the JSON in
// and out, and (b) VROOM's own loading + solving times. With
// --native, also runs each native CLI with -t 1 and reports its own
// loading + solving median. Writes test/results/bench.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const natives = [];
let dir = resolve(HERE, '..');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--native') natives.push(args[++i]);
  else dir = resolve(args[i]);
}
const RUNS = Number(process.env.RUNS ?? 5);
const LEVELS = (process.env.LEVELS ?? '0,1,2,3,4,5').split(',').map(Number);
const CASES = ['bench-25x3', 'bench-60x4'];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const own = (out) => out.summary.computing_times.loading + out.summary.computing_times.solving;

const t0 = performance.now();
const { createVroom } = await import(pathToFileURL(join(dir, 'vroom-solver.mjs')).href);
const vroom = await createVroom();
const initMs = performance.now() - t0;
console.log(`node ${process.version}, ${dir}, init ${initMs.toFixed(1)} ms, ${RUNS} runs, median`);

const rows = [];
for (const name of CASES) {
  const file = join(HERE, 'fixtures', `${name}.json`);
  const text = readFileSync(file, 'utf8');
  for (const x of LEVELS) {
    vroom.solveJson(text, { explorationLevel: x }); // warm-up
    const wall = [];
    const inside = [];
    let cost;
    for (let r = 0; r < RUNS; r++) {
      const s = performance.now();
      const out = JSON.parse(vroom.solveJson(text, { explorationLevel: x }));
      wall.push(performance.now() - s);
      inside.push(own(out));
      cost = out.summary.cost;
    }
    const row = {
      case: name,
      x,
      cost,
      wasmWallMs: +median(wall).toFixed(1),
      wasmVroomMs: median(inside),
    };
    for (const [k, bin] of natives.entries()) {
      const t = [];
      for (let r = 0; r < RUNS; r++) {
        const res = spawnSync(bin, ['-t', '1', '-x', String(x), '-i', file], { encoding: 'utf8' });
        const out = JSON.parse(res.stdout);
        if (out.summary.cost !== cost)
          throw new Error(`native ${bin} cost ${out.summary.cost} != wasm ${cost}`);
        t.push(own(out));
      }
      row[`native${k}VroomMs`] = median(t);
    }
    rows.push(row);
    console.log(
      `${name} x=${x}  cost ${cost}  wasm wall ${row.wasmWallMs} ms  wasm vroom ${row.wasmVroomMs} ms` +
        natives.map((_, k) => `  native${k} ${row[`native${k}VroomMs`]} ms`).join(''),
    );
  }
}

mkdirSync(join(HERE, 'results'), { recursive: true });
writeFileSync(
  join(HERE, 'results', 'bench.json'),
  // Paths are recorded relative to this folder, and the native CLIs by name, so the results name
  // no machine.
  JSON.stringify(
    {
      node: process.version,
      dir: relative(join(HERE, '..'), dir) || '.',
      initMs: +initMs.toFixed(1),
      runs: RUNS,
      natives: natives.map((n) => basename(dirname(dirname(n)))),
      rows,
    },
    null,
    2,
  ) + '\n',
);
