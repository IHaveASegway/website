// Renders public/favicon.svg, the one source for the site's icons, into the two raster files
// clients ask for by name: /favicon.ico (16, 32 and 48 px) and /apple-touch-icon.png (180 px).
// Run it after changing the SVG:  pnpm --filter web icons
//
// Chromium draws the SVG. Only the chunks an image needs survive, so no metadata (EXIF, XMP,
// IPTC, text, timestamps) can ship; scripts/image-metadata.mjs checks that again in verify.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/** Drops every PNG chunk an image does not need to render. @param {Buffer} png */
function stripPng(png) {
  const parts = [PNG_SIGNATURE];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const chunk = png.subarray(at, at + 12 + length);
    if (KEEP.has(chunk.toString('latin1', 4, 8))) parts.push(chunk);
    at += 12 + length;
  }
  return Buffer.concat(parts);
}

/** Packs PNG images into an ICO file, which browsers since 2007 read. @param {{size: number, png: Buffer}[]} images */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const publicDir = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', publicDir), 'utf8');
const browser = await chromium.launch();
try {
  /** @param {number} size */
  const render = async (size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const png = stripPng(await page.screenshot({ type: 'png', omitBackground: true }));
    await page.close();
    return png;
  };
  const sizes = [16, 32, 48];
  const images = [];
  for (const size of sizes) images.push({ size, png: await render(size) });
  await writeFile(new URL('favicon.ico', publicDir), ico(images));
  await writeFile(new URL('apple-touch-icon.png', publicDir), await render(180));
} finally {
  await browser.close();
}
console.log('icons: wrote public/favicon.ico and public/apple-touch-icon.png');
