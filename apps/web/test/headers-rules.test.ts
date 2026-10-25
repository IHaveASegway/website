import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { read } from './support/dist';
import { headersFor, rules } from './support/headers';

// public/_headers as policy (security.md, "Headers and Content Security Policy"). The page policy
// is not in it: the build writes it into dist/_headers (src/lib/csp.mjs, ADR 0018), which
// test/csp.test.ts reads page by page. One response is not a page: the Route Lab's solver worker
// takes its policy from its own response, and compiling WebAssembly needs 'wasm-unsafe-eval' (ADR
// 0016). So in public/_headers exactly one rule may send a script-src, the solver folder's, with
// exactly the policy below, after detaching the page policy, which would otherwise be enforced
// beside it and refuse the compile; and no rule anywhere may loosen script execution further.
// e2e/headers.spec.ts checks the same values as a server sends them.

export const SOLVER_RULE = '/lab/routes/solver/*';
export const SOLVER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** A rule's headers as [name, value] pairs, its detach lines left out. */
const headersOf = (rule: ReturnType<typeof rules>[number]) =>
  rule.lines.flatMap((line) => (line.detach ? [] : [[line.name, line.value] as const]));

/** Why public/_headers breaks the rule above, one line each; empty when it keeps it. */
export function problems(text: string): string[] {
  const all = rules(text);
  const out: string[] = [];
  const scripts = all.filter((r) =>
    headersOf(r).some(
      ([name, value]) => name === 'content-security-policy' && /script-src/.test(value),
    ),
  );
  if (scripts.length !== 1 || scripts[0]?.path !== SOLVER_RULE)
    out.push(`a script-src is sent by ${scripts.map((r) => r.path).join(', ') || 'no rule'}`);
  const solver = all.find((r) => r.path === SOLVER_RULE);
  const detach = solver?.lines.findIndex((l) => l.detach && l.name === 'content-security-policy');
  const own = solver?.lines.findIndex((l) => !l.detach && l.name === 'content-security-policy');
  if (solver && (detach === undefined || detach < 0 || (own ?? -1) < detach))
    out.push(`${SOLVER_RULE} does not detach the page policy before its own`);
  for (const rule of all) {
    for (const [name, value] of headersOf(rule)) {
      if (/'unsafe-(eval|inline|hashes)'/.test(value)) out.push(`${rule.path} sends ${value}`);
      if (/'wasm-unsafe-eval'/.test(value) && rule.path !== SOLVER_RULE)
        out.push(`${rule.path} sends 'wasm-unsafe-eval'`);
      if (
        rule.path === SOLVER_RULE &&
        name === 'content-security-policy' &&
        value !== SOLVER_POLICY
      )
        out.push(`${SOLVER_RULE} sends ${value}`);
    }
  }
  return out;
}

const source = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

describe('public/_headers', () => {
  test('one rule sends a script-src: the solver worker’s, exactly, and nothing loosens a page', () => {
    expect(problems(source)).toEqual([]);
  });

  test('the solver folder is cached for a year: its name changes with its bytes', () => {
    const rule = rules(source).find((r) => r.path === SOLVER_RULE);
    expect(rule && headersOf(rule)).toContainEqual([
      'cache-control',
      'public, max-age=31536000, immutable',
    ]);
  });

  test('the "/*" rule sends no policy: the build writes the page policy there', () => {
    const every = rules(source).find((r) => r.path === '/*');
    expect(
      every && headersOf(every).filter(([name]) => name === 'content-security-policy'),
    ).toEqual([]);
  });
});

// The build's _headers, resolved for a path as the asset server does: one policy on every response
// but a hashed bundle's, the page policy on pages and on every other file, and the solver's own on
// its folder.
describe('dist/_headers, as the server resolves it', () => {
  const built = read('_headers');
  const policy = (path: string) => headersFor(built, path).get('content-security-policy') ?? '';

  test('the solver folder gets its own policy alone, not the page policy beside it', () => {
    expect(policy('/lab/routes/solver/x/vroom-worker.mjs')).toBe(SOLVER_POLICY);
  });

  test('every response that can be a document, the solver folder and its 404 included, refuses to be framed', () => {
    for (const path of [
      '/',
      '/lab/routes/',
      '/nope/',
      '/lab/routes/solver/x/vroom.wasm',
      '/lab/routes/solver/nope',
    ]) {
      expect(policy(path), path).toMatch(/(^|; )frame-ancestors 'none'(;|$)/);
    }
  });

  test('every other response gets one page policy, with no wasm-unsafe-eval', () => {
    for (const path of ['/', '/lab/routes/', '/nope/', '/favicon.svg', '/rss.xml']) {
      expect(policy(path), path).toMatch(/^default-src 'self';/);
      expect(policy(path), path).not.toContain(',');
      expect(policy(path), path).not.toContain('wasm-unsafe-eval');
    }
  });

  // A hashed bundle is a script, a stylesheet or a font, never a document or a worker: the
  // policies only those obey are detached, and the rest stay.
  test('a hashed bundle carries no document policy, and keeps nosniff and its year of cache', () => {
    const bundle = headersFor(built, '/_astro/Base.x.css');
    for (const name of [
      'content-security-policy',
      'permissions-policy',
      'cross-origin-opener-policy',
    ])
      expect(bundle.has(name), name).toBe(false);
    expect(bundle.get('x-content-type-options')).toBe('nosniff');
    expect(bundle.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(headersFor(built, '/').has('permissions-policy')).toBe(true);
  });
});

describe('known answers', () => {
  const solver = `${SOLVER_RULE}\n  ! Content-Security-Policy\n  Content-Security-Policy: ${SOLVER_POLICY}\n`;
  const every = '/*\n  X-Content-Type-Options: nosniff\n';

  test('known answers: the server reads "! Name" only with the space, a path defined twice by its last rule, and a host as a rule', () => {
    const page = "/*\n  Content-Security-Policy: default-src 'self'\n";
    const unspaced = `${SOLVER_RULE}\n  !Content-Security-Policy\n  Content-Security-Policy: ${SOLVER_POLICY}\n`;
    expect(
      headersFor(`${page}\n${unspaced}`, '/lab/routes/solver/x/a.mjs').get(
        'content-security-policy',
      ),
    ).toBe(`default-src 'self', ${SOLVER_POLICY}`);
    const twice = '/*\n  X-A: first\n\n/x\n  X-B: c\n\n/*\n  X-A: last\n';
    expect(headersFor(twice, '/x').get('x-a')).toBe('last');
    expect([...headersFor(twice, '/x').keys()]).toEqual(['x-a', 'x-b']);
    // A URL with a host opens a rule of its own, so its header is not the rule above's.
    const host = '/x\n  X-A: b\nhttps://example.com/x\n  X-C: d\n';
    expect(rules(host).map((rule) => rule.path)).toEqual(['/x', 'https://example.com/x']);
    expect([...headersFor(host, '/x').keys()]).toEqual(['x-a']);
  });

  test('a solver rule that does not detach the page policy fails, and resolves to two policies', () => {
    const attached = `${SOLVER_RULE}\n  Content-Security-Policy: ${SOLVER_POLICY}\n`;
    expect(problems(`${every}\n${attached}`)).toEqual([
      `${SOLVER_RULE} does not detach the page policy before its own`,
    ]);
    const page = "/*\n  Content-Security-Policy: default-src 'self'\n";
    expect(
      headersFor(`${page}\n${attached}`, '/lab/routes/solver/x/a.mjs').get(
        'content-security-policy',
      ),
    ).toBe(`default-src 'self', ${SOLVER_POLICY}`);
    expect(
      headersFor(`${page}\n${solver}`, '/lab/routes/solver/x/a.mjs').get('content-security-policy'),
    ).toBe(SOLVER_POLICY);
  });

  test('the file as it should be passes', () => {
    expect(problems(`# a comment: 'unsafe-eval'\n${every}\n${solver}`)).toEqual([]);
  });

  test('a second rule with wasm-unsafe-eval, the policy on "/*", or unsafe-eval anywhere fails', () => {
    expect(
      problems(`${every}\n${solver}\n/lab/other/*\n  Content-Security-Policy: ${SOLVER_POLICY}\n`),
    ).not.toEqual([]);
    expect(problems(`/*\n  Content-Security-Policy: ${SOLVER_POLICY}\n`)).not.toEqual([]);
    expect(
      problems(
        `${every}\n${SOLVER_RULE}\n  Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-eval'\n`,
      ),
    ).not.toEqual([]);
    expect(problems(`${every}\n${solver}\n/x\n  X-Note: 'unsafe-inline'\n`)).not.toEqual([]);
  });

  test('a solver rule that drops connect-src, or no solver rule, fails', () => {
    expect(
      problems(
        `${every}\n${SOLVER_RULE}\n  ! Content-Security-Policy\n  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'\n`,
      ),
    ).not.toEqual([]);
    expect(problems(every)).toEqual(['a script-src is sent by no rule']);
  });
});
