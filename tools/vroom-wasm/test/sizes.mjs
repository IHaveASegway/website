// Sizes of the shipped files: raw, gzip -9 and brotli quality 11.
//
//   node test/sizes.mjs [DIR]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const FILES = ['vroom.wasm', 'vroom.mjs', 'vroom-solver.mjs', 'vroom-worker.mjs'];
const rows = [];
for (const f of FILES) {
  let buf;
  try {
    buf = readFileSync(join(dir, f));
  } catch {
    continue;
  }
  rows.push({
    file: f,
    raw: buf.length,
    gzip9: gzipSync(buf, { level: 9 }).length,
    brotli11: brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
  });
}
const total = rows.reduce(
  (t, r) => ({ raw: t.raw + r.raw, gzip9: t.gzip9 + r.gzip9, brotli11: t.brotli11 + r.brotli11 }),
  { raw: 0, gzip9: 0, brotli11: 0 },
);
console.log(
  `${'file'.padEnd(18)}${'raw B'.padStart(10)}${'gzip -9 B'.padStart(12)}${'brotli 11 B'.padStart(13)}`,
);
for (const r of [...rows, { file: 'total', ...total }])
  console.log(
    `${r.file.padEnd(18)}${String(r.raw).padStart(10)}${String(r.gzip9).padStart(12)}${String(r.brotli11).padStart(13)}`,
  );
