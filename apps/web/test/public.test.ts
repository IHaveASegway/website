import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The files clients and crawlers read by convention, checked before they deploy. The weekly audit
// checks the live copies again (scripts/verify-zone.sh).

const read = (path: string) => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');
const DAY = 24 * 3600 * 1000;

test('security.txt follows RFC 9116, with an Expires under a year away and over 30 days away', () => {
  const fields = new Map<string, string[]>();
  for (const line of read('.well-known/security.txt').split('\n')) {
    const match = /^([A-Za-z-]+):\s*(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) fields.set(match[1], [...(fields.get(match[1]) ?? []), match[2]]);
  }
  expect(fields.get('Contact')).toEqual(['mailto:hello@ihaveasegway.com']);
  expect(fields.get('Preferred-Languages')).toEqual(['en']);
  expect(fields.get('Canonical')).toEqual(['https://ihaveasegway.com/.well-known/security.txt']);
  const expires = fields.get('Expires') ?? [];
  expect(expires).toHaveLength(1);
  const remaining = Date.parse(expires[0] ?? '') - Date.now();
  expect(remaining, 'move Expires forward: the yearly row in operations.md').toBeGreaterThan(
    30 * DAY,
  );
  expect(remaining, 'RFC 9116 recommends less than a year').toBeLessThan(365 * DAY);
});

test('robots.txt points crawlers at the sitemap and blocks no one (Q15)', () => {
  const robots = read('robots.txt');
  expect(robots).toContain('Sitemap: https://ihaveasegway.com/sitemap-index.xml');
  expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
});
