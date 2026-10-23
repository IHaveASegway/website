import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, describe, expect, test } from 'vitest';

// Known answers for scripts/image-metadata.mjs, the check the pre-commit hook and verify run on
// every image (security.md, "What regex cannot see"). Each fixture is a tiny synthetic image, made
// here, with or without one metadata block; the script must pass the clean ones and refuse the rest.

const script = fileURLToPath(new URL('../../../scripts/image-metadata.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'image-metadata-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(name: string, bytes: Buffer): { status: number | null; output: string } {
  const file = join(dir, name);
  writeFileSync(file, bytes);
  const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(...extra: Buffer[]): Buffer {
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]); // 1×1, 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    ...extra,
    pngChunk('IEND'),
  ]);
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}
function jpeg(...extra: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...extra,
    Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9]), // start of scan, end of image
  ]);
}

function riffChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
}
function webp(...extra: Buffer[]): Buffer {
  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])),
    ...extra,
  ]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

const block = Buffer.from('jumb-and-anything-else', 'latin1');

describe('clean images pass', () => {
  for (const [name, bytes] of [
    ['clean.png', png()],
    ['clean.jpg', jpeg()],
    ['clean.webp', webp()],
  ] as const) {
    test(name, () => expect(run(name, bytes).status).toBe(0));
  }
});

describe('images that carry metadata are refused', () => {
  for (const [name, bytes, label] of [
    ['text.png', png(pngChunk('tEXt', Buffer.from('Author\0someone', 'latin1'))), 'tEXt'],
    ['exif.png', png(pngChunk('eXIf', block)), 'eXIf'],
    ['c2pa.png', png(pngChunk('caBX', block)), 'caBX'],
    ['exif.jpg', jpeg(jpegSegment(0xe1, Buffer.from('Exif\0\0', 'latin1'))), 'APP1'],
    ['c2pa.jpg', jpeg(jpegSegment(0xeb, block)), 'APP11'],
    ['iptc.jpg', jpeg(jpegSegment(0xed, block)), 'APP13'],
    ['exif.webp', webp(riffChunk('EXIF', block)), 'EXIF'],
    ['xmp.webp', webp(riffChunk('XMP ', block)), 'XMP'],
    ['c2pa.webp', webp(riffChunk('C2PA', block)), 'C2PA'],
  ] as const) {
    test(`${name}: ${label}`, () => {
      const { status, output } = run(name, bytes);
      expect(status).toBe(1);
      expect(output).toContain(label);
    });
  }
});

test('a format the check cannot read is "cannot tell", never clean', () => {
  expect(run('unknown.png', Buffer.from('not an image at all')).status).toBe(2);
});
