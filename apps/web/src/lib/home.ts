// Home's figures (docs/design/home.md, "The record"; ADR 0028): every number Home prints is worked
// out at build from the system of record it counts, never typed. This module is pure: the
// rules that turn the records into figures, with known answers in test/home.test.ts. Reading the
// records (the repository's history, docs/adr/, the test files) is lib/home-sources.ts.

/** A decision record as Home counts it: its number, its title and the day it was decided, the
 *  first date on its Status line. */
export interface Decision {
  readonly number: string;
  readonly title: string;
  readonly day: string;
}

/**
 * A decision record from its file's text, or null for a file that is not one (the index, a
 * template): its "# ADR nnnn: title" heading and the first YYYY-MM-DD on its "Status:" line. An
 * accepted record that was proposed earlier is dated by the first date, when it was decided.
 */
export function decisionOf(text: string): Decision | null {
  const head = /^# ADR (\d{4}): (.+)$/m.exec(text);
  const status = /^Status:.*?(\d{4}-\d{2}-\d{2})/m.exec(text);
  if (!head || !status) return null;
  return { number: head[1] ?? '', title: (head[2] ?? '').trim(), day: status[1] ?? '' };
}

/** Test declarations in a test file's source: each `test('…'` or `it('…'`, written once however
 *  many times a loop runs it. `test.skip(condition, …)` and `test.describe(…)` are not tests. */
export function testsIn(source: string): number {
  return (
    source.match(/(?<![\w.])(?:test|it)(?:\.(?:only|fails|concurrent))?\(\s*[`'"]/g)?.length ?? 0
  );
}

/** A count in figures with thousands separated: "8,600". */
export const figure = (n: number): string => n.toLocaleString('en-US');
