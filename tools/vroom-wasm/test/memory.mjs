// Wasm memory across repeated solves in one module: must not grow
// without bound (a leak would make a long demo session fail).
//
//   node test/memory.mjs [DIR_WITH_vroom-solver.mjs]
//
// Reads the size of the module's WebAssembly.Memory after each batch.
// Exits 1 if memory after the last batch exceeds memory after the
// first solve by more than 16 MiB.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] ?? join(HERE, '..'));

// Catch the instance as the glue creates it, to read its memory.
let instanceExports;
const instantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (...args) => {
  const result = await instantiate(...args);
  instanceExports = (result.instance ?? result).exports;
  return result;
};
const { createVroom } = await import(pathToFileURL(join(dir, 'vroom-solver.mjs')).href);
const vroom = await createVroom();
WebAssembly.instantiate = instantiate;
const memory = Object.values(instanceExports).find((e) => e instanceof WebAssembly.Memory);
const mib = () => memory.buffer.byteLength / 1048576;

console.log(`after start-up: ${mib().toFixed(1)} MiB`);
let first;
for (const [name, x, n] of [
  ['bench-25x3', 5, 30],
  ['bench-60x4', 5, 10],
  ['bench-60x4', 0, 200],
  ['big-200x8', 0, 3],
]) {
  const text = readFileSync(join(HERE, 'fixtures', `${name}.json`), 'utf8');
  for (let i = 0; i < n; i++) {
    vroom.solveJson(text, { explorationLevel: x });
    first ??= mib();
  }
  console.log(`${n} x ${name} at x=${x}: ${mib().toFixed(1)} MiB`);
}
const grew = mib() - first;
console.log(`growth after the first solve: ${grew.toFixed(1)} MiB`);
process.exit(grew > 16 ? 1 : 0);
