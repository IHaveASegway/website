// Module worker that runs VROOM off the main thread.
//
//   const worker = new Worker(new URL("./vroom-worker.mjs", import.meta.url),
//                             { type: "module" });
//   worker.postMessage({ id: 1, input, options: { explorationLevel: 5 } });
//   worker.onmessage = ({ data }) => { data.id, data.output, data.ms };
//
// One solve at a time per worker; messages queue in order.
import { createVroom } from "./vroom-solver.mjs";

const ready = createVroom();

self.onmessage = async ({ data }) => {
  const { id, input, options } = data;
  try {
    const vroom = await ready;
    const start = performance.now();
    const output = vroom.solve(input, options);
    self.postMessage({
      id,
      output,
      ms: performance.now() - start,
      version: vroom.version,
    });
  } catch (err) {
    // Only a failed load or a trap gets here; VROOM's own input
    // errors come back as output.code / output.error.
    self.postMessage({ id, failed: String(err) });
  }
};
