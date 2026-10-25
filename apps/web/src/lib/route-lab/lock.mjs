// How the solver's folder is named and what a path inside its WebAssembly looks like, as one
// owner: tools/vroom-wasm/install.mjs writes the folder and its lock with these, and
// test/wasm.test.ts checks the folder that ships against them (ADR 0016). Plain JavaScript, so
// node runs the install script without a build step, as the tests import it.
import { createHash } from 'node:crypto';

/** The first 8 hex digits of a SHA-256 over the files, in the order given. */
export function codeHash(/** @type {readonly Uint8Array[]} */ files) {
  const hash = createHash('sha256');
  for (const bytes of files) hash.update(bytes);
  return hash.digest('hex').slice(0, 8);
}

/**
 * The solver's folder under /lab/routes/solver/: VROOM's version and the hash of every file in it,
 * so the URL changes whenever any of their bytes do, and a year-long immutable cache is safe.
 * @param {string} version VROOM's version, such as 1.15.0
 * @param {readonly Uint8Array[]} files vroom.wasm, vroom.mjs, vroom-solver.mjs, vroom-worker.mjs,
 *   LICENSES.txt
 * @returns {string}
 */
export function solverFolder(version, files) {
  return `vroom-${version}-${codeHash(files)}`;
}

/** A path-like run of printable characters: three or more segments joined by slashes. */
const PATH = /(?:[A-Za-z]:)?[\\/]?(?:[\w.-]+[\\/]){2,}[\w.-]+/g;

/** A path that names a machine, a person or a home directory. */
export const MACHINE_PATH = /(?:^|[\\/])(?:home|root|Users|tmp|var\/folders)[\\/]|^[A-Za-z]:\\/;

/**
 * Every path-like string in a binary's printable runs (four characters or more), once each, in
 * order: what a build can leave behind of the machine it ran on.
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
export function pathStrings(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const found = new Set();
  for (const [run] of text.matchAll(/[\x20-\x7e]{4,}/g)) {
    for (const [path] of run.matchAll(PATH)) {
      if (/[A-Za-z]{2}/.test(path)) found.add(path);
    }
  }
  return [...found];
}
