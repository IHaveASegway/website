// Thin wrapper over the Emscripten module in vroom.mjs.
//
//   import { createVroom } from "./vroom-solver.mjs";
//   const vroom = await createVroom();
//   const output = vroom.solve(input);              // VROOM input object
//   const text = vroom.solveJson(JSON.stringify(input), { explorationLevel: 5 });
//
// solve() returns VROOM's output object, exactly what the vroom CLI
// prints. On bad input it returns VROOM's error object
// ({ code, error }); it never throws for a VROOM error. Locations must
// be indices into input.matrices: this build has no routing engine.
import createVroomModule from "./vroom.mjs";

export async function createVroom(moduleOptions = {}) {
  const m = await createVroomModule(moduleOptions);
  const version = m.UTF8ToString(m._vroom_version());

  function solveJson(inputJson, options = {}) {
    const { explorationLevel = 5, timeoutMs = -1 } = options;
    // The limit is a C int: past 2^31 - 1 ms, "| 0" would wrap it negative,
    // which means no limit, so it is clamped instead. Negative or not a
    // number means no limit.
    const limit =
      timeoutMs >= 0 ? Math.min(Math.floor(timeoutMs), 0x7fffffff) : -1;
    // Heap copy, not ccall's stack copy: a 200-stop matrix is ~300 KB.
    const ptr = m.stringToNewUTF8(inputJson);
    try {
      return m.UTF8ToString(
        m._vroom_solve(ptr, explorationLevel | 0, limit),
      );
    } finally {
      m._free(ptr);
    }
  }

  function solve(input, options) {
    return JSON.parse(solveJson(JSON.stringify(input), options));
  }

  return { version, solve, solveJson };
}
