// Installs a built solver into the site: the four code files and one licence file, in a folder
// named for the solver's version and the first 8 hex digits of a SHA-256 over all five files, so
// the URL changes whenever the bytes do and the files can be cached as immutable (ADR 0016). Then
// it writes the lock that apps/web/test/wasm.test.ts holds the folder to.
//
//   node tools/vroom-wasm/install.mjs [<dir with vroom.mjs and vroom.wasm>]
//
// The directory defaults to this folder, where build/build.sh writes them. The two wrappers,
// vroom-solver.mjs and vroom-worker.mjs, always come from this folder: they are the source. Any
// other solver folder under the site's solver path is removed, so exactly one ships.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathStrings, solverFolder } from '../../apps/web/src/lib/route-lab/lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SOLVER = join(REPO, 'apps/web/public/lab/routes/solver');
const LOCK = join(REPO, 'apps/web/src/lib/route-lab/solver.lock.json');
const built = resolve(process.argv[2] ?? HERE);

const env = Object.fromEntries(
  readFileSync(join(HERE, 'build/versions.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => line.split('=', 2)),
);
const version = env.VROOM_TAG.replace(/^v/, '');

/** The code files, in the order the folder's hash reads them. */
const code = {
  'vroom.wasm': readFileSync(join(built, 'vroom.wasm')),
  'vroom.mjs': readFileSync(join(built, 'vroom.mjs')),
  'vroom-solver.mjs': readFileSync(join(HERE, 'vroom-solver.mjs')),
  'vroom-worker.mjs': readFileSync(join(HERE, 'vroom-worker.mjs')),
};

// Every licence for what is compiled in, from the texts build.sh copied out of the exact sources
// it built, under one header each. dlmalloc, Emscripten's allocator, is public domain and has no
// file of its own.
const licences = readdirSync(join(HERE, 'licenses'))
  .filter((name) => name.endsWith('.txt'))
  .sort();
const LICENSES = Buffer.from(
  [
    `Licences for the solver in this folder: VROOM ${version}, compiled to WebAssembly with Emscripten ${env.EMSDK_VERSION}.`,
    'Each text below is copied from the exact source the build compiled.',
    "dlmalloc, Emscripten's memory allocator, is in the public domain (CC0) and has no licence text.",
    '',
    ...licences.flatMap((name) => [
      '='.repeat(78),
      name.replace(/\.txt$/, ''),
      '='.repeat(78),
      '',
      readFileSync(join(HERE, 'licenses', name), 'utf8').trimEnd(),
      '',
    ]),
  ].join('\n'),
);

// The folder's name hashes every file in it, the licences too: _headers caches the whole folder
// as immutable for a year, so a file whose bytes change must change the URL.
const folder = solverFolder(version, [...Object.values(code), LICENSES]);
const files = { ...code, 'LICENSES.txt': LICENSES };

mkdirSync(SOLVER, { recursive: true });
for (const name of readdirSync(SOLVER)) {
  if (name !== folder) rmSync(join(SOLVER, name), { recursive: true, force: true });
}
mkdirSync(join(SOLVER, folder), { recursive: true });
for (const [name, bytes] of Object.entries(files)) writeFileSync(join(SOLVER, folder, name), bytes);

const module = new WebAssembly.Module(code['vroom.wasm']);
const lock = {
  vroom: { version, tag: env.VROOM_TAG, commit: env.VROOM_COMMIT },
  rapidjson: env.RAPIDJSON_COMMIT,
  emsdk: env.EMSDK_VERSION,
  build: 'tools/vroom-wasm/build/build.sh: -O3 -fwasm-exceptions, one thread, no routing engine',
  folder,
  files: Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') },
    ]),
  ),
  wasm: {
    imports: WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}:${i.kind}`),
    exports: WebAssembly.Module.exports(module).map((e) => `${e.name}:${e.kind}`),
    paths: pathStrings(code['vroom.wasm']),
  },
};
mkdirSync(dirname(LOCK), { recursive: true });
writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`installed ${folder} and wrote ${LOCK.slice(REPO.length + 1)}`);
