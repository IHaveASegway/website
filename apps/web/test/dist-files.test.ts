import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { app, dist, files, kindOf, kinds, type Kind } from './support/dist';

// Every file the site serves is read by some check (spec B8: the scans cover every file). The text
// scans (hold list, readiness, timestamps) read every file that is UTF-8 text, whatever its name.
// A binary they cannot read must be a kind with a check of its own: PNG and ICO images here, WOFF2
// fonts in fonts.test.ts. Anything else fails, so a new kind of file arrives with its check.

const BINARY_CHECKS: Readonly<Record<Exclude<Kind, 'text' | 'unreadable'>, string>> = {
  png: 'the image metadata check below; og.test.ts reads the Open Graph image',
  ico: 'the image metadata check below',
  woff2: "fonts.test.ts: the lock, the WOFF2 header and the name table's strings",
};

test('every file in dist/ is UTF-8 text or a binary kind with its own check', () => {
  expect(files.length).toBeGreaterThan(0);
  const unread = files.filter((file) => kinds.get(file) === 'unreadable');
  expect(unread, 'add a check for this kind of file, or keep it out of dist/').toEqual([]);
  for (const file of files) {
    const kind = kinds.get(file);
    if (kind && kind !== 'text')
      expect(BINARY_CHECKS[kind as keyof typeof BINARY_CHECKS]).toBeDefined();
  }
});

test('every image in dist/ passes the image metadata check: PNG and ICO by their bytes, SVG', () => {
  const images = files.filter((file) => {
    const kind = kinds.get(file);
    return kind === 'png' || kind === 'ico' || file.endsWith('.svg');
  });
  expect(images.length).toBeGreaterThan(0);
  const result = spawnSync(
    process.execPath,
    [join(app, '../../scripts/image-metadata.mjs'), ...images.map((file) => join(dist, file))],
    { encoding: 'utf8' },
  );
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
});

describe('known answers: a file is classified by its bytes, not its name', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const cases: [string, Uint8Array, Kind][] = [
    ['a PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0), 'png'],
    ['an ICO', bytes(0, 0, 1, 0, 1, 0), 'ico'],
    ['a WOFF2', utf8('wOF2\u0000\u0001'), 'woff2'],
    ['UTF-8 text', utf8('Joseph Peterson · © 2026\n\tindented\r\n'), 'text'],
    ['an empty file', bytes(), 'text'],
    ['bytes that are not UTF-8', bytes(0xff, 0xfe, 0x41), 'unreadable'],
    ['UTF-8 with a NUL in it', utf8('a\u0000b'), 'unreadable'],
    ['a gzip stream', bytes(0x1f, 0x8b, 0x08, 0x00), 'unreadable'],
    ['a TrueType font', bytes(0x00, 0x01, 0x00, 0x00, 0x00, 0x10), 'unreadable'],
  ];
  for (const [name, data, kind] of cases) {
    test(`${name} is ${kind}`, () => expect(kindOf(data)).toBe(kind));
  }
});
