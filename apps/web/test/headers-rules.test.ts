import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// public/_headers as policy (security.md, "Headers and Content Security Policy"). Pages take their
// script policy from Astro's <meta>, which test/csp.test.ts reads. One response is not a page: the
// Route Lab's solver worker takes its policy from its own response, and compiling WebAssembly needs
// 'wasm-unsafe-eval' (ADR 0016). So exactly one rule may send a script-src: the solver folder's,
// with exactly the policy below, and no rule anywhere may loosen script execution further.
// e2e/headers.spec.ts checks the same values as a server sends them.

export const SOLVER_RULE = '/lab/routes/solver/*';
export const SOLVER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

interface Rule {
  readonly path: string;
  readonly headers: readonly (readonly [string, string])[];
}

/** The rules of a _headers file: a path at the start of a line, then its indented headers. */
export function rules(text: string): Rule[] {
  const found: { path: string; headers: [string, string][] }[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (!/^\s/.test(line)) {
      found.push({ path: line.trim(), headers: [] });
      continue;
    }
    const at = line.indexOf(':');
    found.at(-1)?.headers.push([line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]);
  }
  return found;
}

/** Why a _headers file breaks the rule above, one line each; empty when it keeps it. */
export function problems(text: string): string[] {
  const all = rules(text);
  const out: string[] = [];
  const scripts = all.filter((r) =>
    r.headers.some(
      ([name, value]) => name === 'content-security-policy' && /script-src/.test(value),
    ),
  );
  if (scripts.length !== 1 || scripts[0]?.path !== SOLVER_RULE)
    out.push(`a script-src is sent by ${scripts.map((r) => r.path).join(', ') || 'no rule'}`);
  for (const rule of all) {
    for (const [name, value] of rule.headers) {
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
    expect(rule?.headers).toContainEqual(['cache-control', 'public, max-age=31536000, immutable']);
  });

  test('the "/*" rule still sends frame-ancestors alone as its policy', () => {
    const every = rules(source).find((r) => r.path === '/*');
    expect(every?.headers.filter(([name]) => name === 'content-security-policy')).toEqual([
      ['content-security-policy', "frame-ancestors 'none'"],
    ]);
  });
});

describe('known answers', () => {
  const solver = `${SOLVER_RULE}\n  Content-Security-Policy: ${SOLVER_POLICY}\n`;
  const every = "/*\n  Content-Security-Policy: frame-ancestors 'none'\n";

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
        `${every}\n${SOLVER_RULE}\n  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'\n`,
      ),
    ).not.toEqual([]);
    expect(problems(every)).toEqual(['a script-src is sent by no rule']);
  });
});
