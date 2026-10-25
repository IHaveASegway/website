// The page policy, sent as a header written at build (security.md, "Headers and Content Security
// Policy"; ADR 0018). A header applies before the first byte of markup, so it governs every script
// on the page, the pre-paint theme script in <head> included, and frame-ancestors joins the one
// policy. astro.config.mjs runs withPagePolicies once the pages are written, and the unit tests read
// the same functions, so the policy, the pages and the checks cannot drift apart. Plain JavaScript,
// so the config imports it as the tests do.
import { createHash } from 'node:crypto';
import { parse } from 'parse5';

/** The site's directives, on every page: nothing from another origin, no plugins, no <base>, and
 *  never in a frame. A source another origin needs (the Web Analytics beacon's, security.md) goes in
 *  a script-src or style-src entry here, and policyFor puts it after 'self', before the hashes. */
export const DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

/** Directives one page adds, by its path. One the site names too gets both lists' sources, so
 *  Turnstile's script-src on a lab page joins the beacon's (security.md). The Route Lab starts a
 *  module worker and names this origin as the only place one may come from: worker-src allows
 *  nothing script-src 'self' does not, and keeps a later script-src host from also becoming a
 *  worker source (ADR 0016). */
export const PAGE_DIRECTIVES = { '/lab/routes/': ["worker-src 'self'"] };

/** The script types this site hashes: the ones a browser runs or governs as inline script (HTML,
 *  "the script element": no type, a JavaScript MIME type essence, module, importmap and
 *  speculationrules). Any other type is a data block, such as JSON-LD, which no policy governs. */
const SCRIPT_TYPES = new Set([
  '',
  'module',
  'importmap',
  'speculationrules',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/** Cloudflare's _headers limits (workers-shared, parseHeaders): a longer line is skipped and the
 *  rules past the hundredth are dropped, each with only a warning, so the build checks them. */
export const MAX_LINE = 2000;
export const MAX_RULES = 100;

/** A line that opens a _headers rule, as Cloudflare tells one (LINE_IS_PROBABLY_A_PATH): a path,
 *  or a URL with a host. */
const RULE_LINE = /^(?:[^\s]+:\/\/|\/)/;

/** A source expression for the SHA-256 of an inline element's text, as CSP writes it. */
export const hashOf = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/**
 * The inline code a page runs, as the browser's parser reads it: the text of each <script> with no
 * src whose type runs or is governed as script, and of each <style>, an SVG's and a <template>'s
 * included.
 * @param {string} html
 * @returns {{ scripts: string[], styles: string[] }}
 */
export function inlineCode(html) {
  const scripts = [];
  const styles = [];
  const text = (node) => node.childNodes.map((child) => child.value ?? '').join('');
  const attr = (node, name) => node.attrs.find((a) => a.name === name)?.value;
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      if (!('tagName' in child)) continue;
      if (child.tagName === 'script' && attr(child, 'src') === undefined) {
        // The type's essence: a parameter such as "; charset=utf-8" does not change what runs.
        const type = (attr(child, 'type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        if (SCRIPT_TYPES.has(type)) scripts.push(text(child));
      } else if (child.tagName === 'style') {
        styles.push(text(child));
      }
      walk(child.tagName === 'template' ? child.content : child);
    }
  };
  walk(parse(html));
  return { scripts, styles };
}

/**
 * A page's policy: the site's directives and the page's own, each named once, then script-src and
 * style-src: 'self', any source the directives above add, and a hash for each inline script and
 * style the page holds, each source once, in the order they appear. A browser enforces only the
 * first copy of a repeated directive, so a directive both lists name is written once, with both
 * lists' sources. 'none' joins no other source: beside one it means nothing, and the source would
 * win, so that repeat is an error.
 * @param {string} html the built page
 * @param {string} path its path, such as "/lab/routes/"
 * @returns {string}
 */
export function policyFor(html, path) {
  const directives = new Map();
  for (const directive of [...DIRECTIVES, ...(PAGE_DIRECTIVES[path] ?? [])]) {
    const [name = '', ...sources] = directive.trim().split(/\s+/);
    const before = directives.get(name);
    if (before !== undefined && [...before, ...sources].includes("'none'"))
      throw new Error(`csp.mjs: ${name} is named twice for ${path}, and 'none' joins no source`);
    directives.set(name, [...new Set([...(before ?? []), ...sources])]);
  }
  const { scripts, styles } = inlineCode(html);
  const sources = (name, texts) => {
    const added = directives.get(name) ?? [];
    directives.delete(name);
    return [...new Set(["'self'", ...added, ...texts.map(hashOf)])].join(' ');
  };
  const script = sources('script-src', scripts);
  const style = sources('style-src', styles);
  return [
    ...[...directives].map(([name, list]) => [name, ...list].join(' ')),
    `script-src ${script}`,
    `style-src ${style}`,
  ].join('; ');
}

/**
 * The rules of a _headers file as Cloudflare reads it (workers-shared, parseHeaders): lines are
 * trimmed, comments and blank lines skipped, a path or a URL with a host opens a rule (RULE_LINE),
 * "! Name" detaches a header, and any other line is "Name: value".
 * @param {string} text
 * @returns {{ path: string, set: [string, string][], unset: string[] }[]}
 */
export function parseRules(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (RULE_LINE.test(line)) {
      rules.push({ path: line, set: [], unset: [] });
    } else if (line.startsWith('! ')) {
      rules.at(-1)?.unset.push(line.slice(2).trim().toLowerCase());
    } else if (line.includes(':')) {
      const at = line.indexOf(':');
      rules.at(-1)?.set.push([line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]);
    }
  }
  return rules;
}

/**
 * A _headers file with the page policies written in. The 404 page's policy goes on the "/*" rule,
 * which every response matches, so a path no page has gets the 404's own policy. A page whose
 * policy differs gets a rule of its own, which detaches the "/*" policy first: two policies would
 * both be enforced, each only restricting the other. It refuses, rather than write a file the asset
 * server would read otherwise: a "/*" rule that already sends a policy, a second "/*" rule, or one
 * whose line holds more than "/*"; a rule for a page path the file already holds (the server keeps
 * only the last rule for a path); a rule for a host, which the checks do not resolve; and a line or
 * a rule count past Cloudflare's limits, which the server would drop with a warning.
 * @param {string} headers the _headers file public/ holds
 * @param {ReadonlyMap<string, string>} policies each page's path and policy, the 404's as "/404.html"
 * @returns {string}
 */
export function withPagePolicies(headers, policies) {
  const shared = policies.get('/404.html');
  if (shared === undefined) throw new Error('csp.mjs: no 404 page to take the "/*" policy from');
  const before = parseRules(headers);
  const every = before.filter((rule) => rule.path === '/*');
  if (every.length !== 1)
    throw new Error(`csp.mjs: _headers has ${every.length} "/*" rules, not 1, for the policy`);
  if (every[0]?.set.some(([name]) => name === 'content-security-policy'))
    throw new Error('csp.mjs: the "/*" rule already sends a policy: the build owns it');
  const host = before.find((rule) => !rule.path.startsWith('/'));
  if (host !== undefined)
    throw new Error(`csp.mjs: _headers has a rule for a host, ${host.path}: the checks read paths`);
  const own = [...policies]
    .filter(([path, policy]) => path !== '/404.html' && policy !== shared)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [path] of own)
    if (before.some((rule) => rule.path === path))
      throw new Error(`csp.mjs: _headers already has a rule for ${path}`);
  const written = headers.replace(
    /^\/\*\r?\n/m,
    (line) => `${line}  Content-Security-Policy: ${shared}\n`,
  );
  if (written === headers)
    throw new Error('csp.mjs: no _headers line is "/*" alone, so the policy has no place to go');
  const text =
    own.length === 0
      ? written
      : `${written.trimEnd()}\n\n# Pages whose policy differs from the 404's, written at build (src/lib/csp.mjs).\n${own
          .map(
            ([path, policy]) =>
              `${path}\n  ! Content-Security-Policy\n  Content-Security-Policy: ${policy}\n`,
          )
          .join('\n')}`;
  const long = text.split('\n').find((line) => line.trim().length > MAX_LINE);
  if (long !== undefined)
    throw new Error(
      `csp.mjs: a _headers line is over ${MAX_LINE} characters: ${long.slice(0, 80)}…`,
    );
  const count = parseRules(text).length;
  if (count > MAX_RULES)
    throw new Error(`csp.mjs: _headers holds ${count} rules, over ${MAX_RULES}`);
  return text;
}
