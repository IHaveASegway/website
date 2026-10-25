import {
  isMap,
  isScalar,
  parseDocument,
  visit,
  type Document,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
} from 'yaml';

// A post's front matter, read the way Astro reads it, for the checks on post sources. Astro 7.4
// parses front matter with yaml (@astrojs/internal-helpers, yaml.js) under these options: YAML
// 1.2's core schema, plus YAML 1.1's timestamps, which turn an unquoted date into a Date, and merge
// keys. test/pins.test.ts holds this package to the version Astro resolves, so both read a file
// the same way.
const ASTRO_YAML: ParseOptions & DocumentOptions & SchemaOptions = {
  customTags: ['timestamp'],
  merge: true,
  schema: 'core',
};

/** The front matter fence, at the very top of the file: YAML between two `---` lines. Astro also
 *  reads TOML between `+++` lines and tolerates blank lines first; the checks refuse both. */
const FENCE = /^---\r?\n([\s\S]*?\r?\n)?---(?:\r?\n|$)/;

export interface FrontMatter {
  /** The parsed document, with each value's source text. */
  readonly doc: Document.Parsed;
  /** The values, as Astro hands them to the schema. */
  readonly data: Record<string, unknown>;
}

/** A source's front matter, or why it cannot be read the one way the checks accept. */
export function frontMatter(source: string): FrontMatter | { readonly problem: string } {
  const fence = FENCE.exec(source);
  if (!fence) return { problem: 'front matter must open the file, as YAML between two --- lines' };
  const doc = parseDocument(fence[1] ?? '', ASTRO_YAML);
  if (doc.errors.length > 0) return { problem: `front matter: ${doc.errors[0]?.message}` };
  if (!isMap(doc.contents)) return { problem: 'front matter must be a mapping of keys to values' };
  return { doc, data: doc.toJS() as Record<string, unknown> };
}

/** Anchors, aliases and merge keys: each can make a value Astro reads differ from the line that
 *  names the key, so the checks refuse them anywhere in front matter. */
export function indirection(doc: Document.Parsed): string[] {
  const found: string[] = [];
  visit(doc, {
    Alias: (_, node) => void found.push(`an alias, *${node.source}`),
    Pair: (_, pair) => {
      if (isScalar(pair.key) && typeof pair.key.value === 'symbol') found.push('a merge key, <<');
    },
    Node: (_, node) => {
      if ('anchor' in node && node.anchor) found.push(`an anchor, &${node.anchor}`);
    },
  });
  return found;
}

/** A top-level key's value node, if the front matter has the key. */
export function valueNode(doc: Document.Parsed, key: string): unknown {
  return isMap(doc.contents)
    ? doc.contents.items.find((pair) => isScalar(pair.key) && pair.key.value === key)?.value
    : undefined;
}
