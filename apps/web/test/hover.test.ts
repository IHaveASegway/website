import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { app, files, read } from './support/dist';

// A hover style lives under @media (hover: hover). A touch screen keeps :hover on whatever was last
// tapped until the next tap elsewhere, so an unguarded fill stays behind on a phone. It did until
// 2026-11-02: a switch tapped on and off again still looked half on, a paused Run looked pressed, and
// a grey tile stayed behind the theme icon. This reads what ships as well as what is written, so a
// utility class or a plugin can't slip one past. e2e/steady.spec.ts holds the same on a phone.

/** Every selector with :hover in it that no (hover: hover) query guards, with the at-rules around. */
export function unguardedHover(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '{' && c !== '}' && c !== ';') continue;
    const chunk = text.slice(start, i).trim();
    if (c === '{') {
      const guarded = stack.some((prelude) => /hover:\s*hover/.test(prelude));
      if (!chunk.startsWith('@') && chunk.includes(':hover') && !guarded)
        found.push(...chunk.split(',').flatMap((s) => (s.includes(':hover') ? [s.trim()] : [])));
      stack.push(chunk);
    } else if (c === '}') stack.pop();
    start = i + 1;
  }
  return found;
}

describe('a hover style is only for a pointer that can hover', () => {
  const styles = join(app, 'src/styles');
  const written = readdirSync(styles).filter((name) => name.endsWith('.css'));
  const shipped = files.filter((file) => file.endsWith('.css'));

  test('there is something to read', () => {
    expect(written.length).toBeGreaterThan(5);
    expect(shipped.length).toBeGreaterThan(0);
  });

  for (const name of written)
    test(`src/styles/${name}`, () =>
      expect(unguardedHover(readFileSync(join(styles, name), 'utf8'))).toEqual([]));

  for (const file of shipped) test(file, () => expect(unguardedHover(read(file))).toEqual([]));

  test('known answers', () => {
    expect(unguardedHover('.btn:hover{color:red}')).toEqual(['.btn:hover']);
    // A chosen radio keeps its fill on a phone: only its hover moves into the query.
    expect(unguardedHover('.a:hover,.a:has(input:checked){color:red}')).toEqual(['.a:hover']);
    expect(unguardedHover('@media (forced-colors:active){.a:hover{color:red}}')).toEqual([
      '.a:hover',
    ]);
    expect(unguardedHover('@media (hover:hover){.a:hover{color:red}}')).toEqual([]);
    expect(unguardedHover('@media (hover: hover) { .a:hover { color: red } }')).toEqual([]);
    expect(
      unguardedHover('@media (forced-colors:active) and (hover:hover){.a:hover{color:red}}'),
    ).toEqual([]);
    expect(
      unguardedHover('@media print{@media (hover: hover){.a:hover{color:red}}.b{color:red}}'),
    ).toEqual([]);
    expect(unguardedHover('.a:has(input:checked){color:red}')).toEqual([]);
  });
});
