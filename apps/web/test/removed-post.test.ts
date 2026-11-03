import { describe, expect, test } from 'vitest';
import { files, read, textFiles } from './support/dist';

// A post that's been taken down leaves nothing a reader can find (ADR 0005, postscript of 2026-11-03):
// no page, no link to it, no line about it, no skill that cites it, and nothing in a script, a feed or a
// file name. Its URL stays a promise, so it answers with a 301 to its index, and public/_redirects is
// the one file in the build that may say it: Cloudflare reads that file and never serves it, which
// e2e/smoke.spec.ts holds, with a 404 on /_redirects. On every build vitest.config.ts names.

const GONE = /teardown|trading|alpaca|serverless-auto/i;

/** Each place a text or a path gives the post away. */
export const traces = (name: string, text: string): string[] =>
  [name, text].flatMap((said) => {
    const found = GONE.exec(said);
    return found ? [`${name}: ${found[0]}`] : [];
  });

describe('the removed post leaves nothing in the build', () => {
  test('the redirects hold its two 301s, and nothing is served that names it', () => {
    expect(read('_redirects')).toMatch(GONE);
    const served = files.filter((file) => file !== '_redirects');
    const texts = new Set(textFiles);
    expect(
      served.flatMap((file) => traces(file, texts.has(file) ? read(file) : '')),
    ).toEqual([]);
  });

  test('known answers: what it catches, in any case, and what it passes', () => {
    expect(traces('a.html', 'A Trading bot')).toEqual(['a.html: Trading']);
    expect(traces('a.html', 'read the TEARDOWN')).toEqual(['a.html: TEARDOWN']);
    expect(traces('a.html', 'a stock broker, Alpaca')).toEqual(['a.html: Alpaca']);
    expect(traces('serverless-auto.js', '')).toEqual(['serverless-auto.js: serverless-auto']);
    expect(traces('a.html', 'Coding is fun.')).toEqual([]);
  });
});
