import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Worker configuration as policy (ADR 0002). The cache rule covers every Worker in the
// repository, today's and the lab's, because Workers Cache bills each asset request at the Workers
// rate: one key would turn free page views into billed ones.

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** JSON with comments and trailing commas, as Wrangler accepts it, read as plain JSON. */
function parseJsonc(text: string): unknown {
  let json = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      json += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      json += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 1;
    } else {
      json += c;
    }
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'));
}

/** Every Worker configuration in the workspace's package folders. */
const configs = ['apps', 'workers'].flatMap((group) => {
  const dir = join(root, group);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) =>
    ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']
      .map((file) => join(group, name, file))
      .filter((file) => existsSync(join(root, file))),
  );
});

/** Paths of every "cache" object that carries an "enabled" key, anywhere in the config. */
function cacheSettings(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    const found =
      key === 'cache' && child !== null && typeof child === 'object' && 'enabled' in child;
    return [...(found ? [here] : []), ...cacheSettings(child, here)];
  });
}

test('every Worker is configured in wrangler.jsonc, the one format these checks read', () => {
  expect(configs.length).toBeGreaterThan(0);
  expect(configs.filter((file) => !file.endsWith('wrangler.jsonc'))).toEqual([]);
});

for (const file of configs) {
  test(`${file} never enables Workers Cache, at any level`, () => {
    const config = parseJsonc(readFileSync(join(root, file), 'utf8'));
    expect(cacheSettings(config)).toEqual([]);
  });

  test(`${file} carries no account_id: it comes from the CLOUDFLARE_ACCOUNT_ID secret`, () => {
    const config = parseJsonc(readFileSync(join(root, file), 'utf8'));
    expect(JSON.stringify(config)).not.toContain('"account_id"');
  });
}

describe('apps/web/wrangler.jsonc, the site Worker', () => {
  const site = parseJsonc(readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8')) as Record<
    string,
    unknown
  >;

  test('is assets-only: no main, so no request runs Worker code', () => {
    expect(site['name']).toBe('ihaveasegway-web');
    expect(site).not.toHaveProperty('main');
    expect(site['assets']).toEqual({
      directory: './dist',
      not_found_handling: '404-page',
      html_handling: 'auto-trailing-slash',
    });
  });

  test('has one public origin: the custom domain, never workers.dev', () => {
    expect(site['routes']).toEqual([{ pattern: 'ihaveasegway.com', custom_domain: true }]);
    expect(site['workers_dev']).toBe(false);
  });

  test('keeps Version URLs and Worker Previews, which the deploy smoke and pull requests use', () => {
    expect(site['preview_urls']).toBe(true);
    expect(site['previews']).toEqual({});
  });

  test('has observability on and a compatibility_date that is a real past date', () => {
    expect(site['observability']).toEqual({ enabled: true });
    const date = String(site['compatibility_date']);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(`${date}T00:00:00Z`)).toBeLessThanOrEqual(Date.now());
  });
});
