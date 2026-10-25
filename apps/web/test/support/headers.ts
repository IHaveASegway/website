// A _headers file as Cloudflare's asset server reads it (workers-shared: parseHeaders, then the
// asset worker's attachCustomHeaders; wrangler dev runs the same code). Each line is trimmed;
// comments and blank lines are skipped; a line starting with "/" opens a rule; "! Name", with the
// space, detaches a header; any other line with a colon is "Name: value", and one without is
// ignored. A path defined twice keeps its first place and its last definition. For a request, every
// matching rule applies in that order: first its detaches, then its headers, a header set earlier
// in the same pass gaining the new value after a comma. A splat (*) matches anything, a placeholder
// (:name) one path segment. headers-rules.test.ts and csp.test.ts read the files through this, and
// e2e/headers.spec.ts checks the same rules as a server sends them.

export type HeaderLine =
  | { readonly detach: true; readonly name: string }
  | { readonly detach: false; readonly name: string; readonly value: string };

export interface Rule {
  readonly path: string;
  readonly lines: readonly HeaderLine[];
}

/** The rules of a _headers file, in file order, header names lowercased. */
export function rules(text: string): Rule[] {
  const found: { path: string; lines: HeaderLine[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      found.push({ path: line, lines: [] });
    } else if (line.startsWith('! ')) {
      found.at(-1)?.lines.push({ detach: true, name: line.slice(2).trim().toLowerCase() });
    } else if (line.includes(':')) {
      const at = line.indexOf(':');
      found.at(-1)?.lines.push({
        detach: false,
        name: line.slice(0, at).trim().toLowerCase(),
        value: line.slice(at + 1).trim(),
      });
    }
  }
  return found;
}

/** Whether a rule's path matches a request's path. */
export function matches(rulePath: string, path: string): boolean {
  const pattern = rulePath
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) =>
      part === '*'
        ? '.*'
        : part.startsWith(':')
          ? '[^/]+'
          : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  return new RegExp(`^${pattern}$`).test(path);
}

/** The headers a _headers file adds to a response for this path, names lowercased. */
export function headersFor(text: string, path: string): Map<string, string> {
  // A path defined twice: first place, last definition, as an object keyed by path keeps them.
  const byPath = new Map<string, Rule>();
  for (const rule of rules(text)) byPath.set(rule.path, rule);
  const headers = new Map<string, string>();
  const set = new Set<string>();
  for (const rule of [...byPath.values()].filter((r) => matches(r.path, path))) {
    for (const line of rule.lines) if (line.detach) headers.delete(line.name);
    for (const line of rule.lines) {
      if (line.detach) continue;
      const before = set.has(line.name) ? headers.get(line.name) : undefined;
      headers.set(line.name, before === undefined ? line.value : `${before}, ${line.value}`);
      set.add(line.name);
    }
  }
  return headers;
}
