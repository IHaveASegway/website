import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { findHeld, parseHolds } from '../src/lib/held-names';
import { MACHINE_PATH, pathStrings, solverFolder } from '../src/lib/route-lab/lock.mjs';
import lock from '../src/lib/route-lab/solver.lock.json';
import { app, bytes, dist, files, kinds } from './support/dist';

// WebAssembly in dist/ (ADR 0016): the Route Lab's solver, VROOM compiled by
// tools/vroom-wasm/build/build.sh and installed with its lock by tools/vroom-wasm/install.mjs. No
// text scan can read a binary, so this check reads it the way the scans would want: the exact
// bytes the lock pins, no custom section that could carry a name, a path or a source map, exactly
// the imports and exports the lock lists, no machine path or held name among its strings, and
// the answer it gives, solved again here in Node from the bytes that ship.

const SOLVER = 'lab/routes/solver/';
const holds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));

/** A WebAssembly binary's sections, in order: each id, and a custom section's name. */
export function sections(wasm: Uint8Array): { id: number; name?: string }[] {
  const leb = (at: number): [number, number] => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = wasm[at++] ?? 0;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (byte < 0x80) return [value, at];
    }
  };
  const found: { id: number; name?: string }[] = [];
  for (let at = 8; at < wasm.length;) {
    const id = wasm[at] ?? 0;
    const [size, body] = leb(at + 1);
    if (id === 0) {
      const [length, start] = leb(body);
      found.push({ id, name: Buffer.from(wasm.subarray(start, start + length)).toString('utf8') });
    } else found.push({ id });
    at = body + size;
  }
  return found;
}

/** The imports and exports of a module, as the lock writes them. */
export function shape(wasm: Uint8Array): { imports: string[]; exports: string[] } {
  const module = new WebAssembly.Module(new Uint8Array(wasm));
  return {
    imports: WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}:${i.kind}`),
    exports: WebAssembly.Module.exports(module).map((e) => `${e.name}:${e.kind}`),
  };
}

const wasm = files.filter((file) => kinds.get(file) === 'wasm');
const folder = `${SOLVER}${lock.folder}/`;

describe('the solver in dist/', () => {
  test('is the one WebAssembly file, in the one folder the lock names, with exactly its files', () => {
    expect(wasm).toEqual([`${folder}vroom.wasm`]);
    const shipped = files.filter((file) => file.startsWith(SOLVER));
    expect(shipped.map((file) => file.slice(folder.length)).sort()).toEqual(
      Object.keys(lock.files).sort(),
    );
  });

  test("every file's bytes are the lock's, and the folder's name is the hash of all of them", () => {
    for (const [name, pinned] of Object.entries(lock.files)) {
      const data = bytes(`${folder}${name}`);
      expect(
        { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') },
        name,
      ).toEqual(pinned);
    }
    const all = [
      'vroom.wasm',
      'vroom.mjs',
      'vroom-solver.mjs',
      'vroom-worker.mjs',
      'LICENSES.txt',
    ].map((name) => bytes(`${folder}${name}`));
    expect(solverFolder(lock.vroom.version, all)).toBe(lock.folder);
    // The known answer: the licences are hashed too, since the folder is cached for a year, so a
    // change to their text alone changes the URL.
    const licences = all.slice(0, 4).concat(Buffer.from('another licence text'));
    expect(solverFolder(lock.vroom.version, licences)).not.toBe(lock.folder);
  });

  test('the two wrappers are their source in tools/vroom-wasm, byte for byte', () => {
    for (const name of ['vroom-solver.mjs', 'vroom-worker.mjs']) {
      expect(
        bytes(`${folder}${name}`).equals(readFileSync(join(app, '../../tools/vroom-wasm', name))),
        name,
      ).toBe(true);
    }
  });

  for (const file of wasm) {
    describe(file, () => {
      const data = bytes(file);

      test('has no custom section: no name, producers, source map or debug section', () => {
        expect(sections(data).filter((s) => s.id === 0)).toEqual([]);
      });

      test('imports and exports exactly what the lock lists', () => {
        expect(shape(data)).toEqual({ imports: lock.wasm.imports, exports: lock.wasm.exports });
      });

      test('its strings name no machine and no held name; its paths are the lock’s', () => {
        const paths = pathStrings(data);
        expect(paths).toEqual(lock.wasm.paths);
        expect(paths.filter((p) => MACHINE_PATH.test(p))).toEqual([]);
        const strings = (
          Buffer.from(data)
            .toString('latin1')
            .match(/[\x20-\x7e]{4,}/g) ?? []
        ).join('\n');
        expect(findHeld(strings, holds, 'script')).toEqual([]);
      });
    });
  }

  // The golden solve: the default day, a busy Saturday, at VROOM's default exploration level, from
  // the bytes in dist/. The routes are VROOM's answer as of this lock; a new build that answers
  // differently changes this test in the same pull request as the lock.
  test('solves the busy Saturday as the lock’s build did: cost 11,504 s, these routes', async () => {
    const data = JSON.parse(
      readFileSync(join(app, '../../tools/route-data/out/route-data.json'), 'utf8'),
    );
    const { capacityFor, fromVroom, vroomInput } = await import('../src/lib/route-lab/plan');
    const solver = (await import(pathToFileURL(join(dist, folder, 'vroom-solver.mjs')).href)) as {
      createVroom(): Promise<{ version: string; solve(i: unknown, o: unknown): never }>;
    };
    const vroom = await solver.createVroom();
    expect(vroom.version).toBe(lock.vroom.version);
    const busy = data.scenarios.find((s: { id: string }) => s.id === 'busy');
    const capacity = capacityFor(data, busy.stops, busy.vans);
    const output = vroom.solve(vroomInput(data, busy.stops, busy.vans, capacity), {
      explorationLevel: 5,
    }) as { summary: { cost: number } };
    expect(output.summary.cost).toBe(11_504);
    expect(fromVroom(output as never, busy.vans).routes).toEqual([
      [12, 13, 1, 8, 7, 4, 33, 2, 25],
      [30, 31, 38, 39, 55, 40, 43, 46, 50],
      [22, 23],
    ]);
  });
});

describe('known answers', () => {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const type = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00]; // one type: a function of nothing
  const imports = [0x02, 0x07, 0x01, 0x01, 0x61, 0x01, 0x7a, 0x00, 0x00]; // a.z, a function
  const named = [0x00, 0x07, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x00, 0x00]; // a "name" section
  const module = (...parts: number[][]) => Uint8Array.from([...header, ...parts.flat()]);

  test('a custom section is found by its name', () => {
    expect(sections(module(type, named))).toEqual([{ id: 1 }, { id: 0, name: 'name' }]);
    expect(sections(module(type)).filter((s) => s.id === 0)).toEqual([]);
  });

  test('an import the lock does not list changes the shape', () => {
    expect(shape(module(type, imports)).imports).toEqual(['a.z:function']);
    expect(shape(module(type)).imports).toEqual([]);
  });

  test('a machine path among the strings is found and named', () => {
    const strings = Buffer.from(
      '\u0000\u0001/home/x/emsdk/vroom.cpp\u0000/emsdk/emscripten/a.cpp\u0000',
    );
    const paths = pathStrings(strings);
    expect(paths).toEqual(['/home/x/emsdk/vroom.cpp', '/emsdk/emscripten/a.cpp']);
    expect(paths.filter((p) => MACHINE_PATH.test(p))).toEqual(['/home/x/emsdk/vroom.cpp']);
    expect(MACHINE_PATH.test('C:\\Users\\x\\a.cpp')).toBe(true);
    expect(MACHINE_PATH.test('/Users/x/a.cpp')).toBe(true);
  });

  test('the folder name changes when any code byte does', () => {
    const a = [Buffer.from('wasm'), Buffer.from('glue')];
    expect(solverFolder('1.15.0', a)).toMatch(/^vroom-1\.15\.0-[0-9a-f]{8}$/);
    expect(solverFolder('1.15.0', [Buffer.from('wasm'), Buffer.from('gluE')])).not.toBe(
      solverFolder('1.15.0', a),
    );
  });
});
