import { parse, type DefaultTreeAdapterTypes } from 'parse5';

// HTML as a browser reads it, for the checks whose answer depends on what the browser sees: which
// element carries which attribute (the policy refuses style attributes), and what a post's body
// holds (no images yet). parse5 implements the WHATWG parsing algorithm the browser runs, so a ">"
// inside a quoted value, a comment, or a script's text reads as it does in Chromium, which no
// regular expression over the markup does.

export type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/** Every element of a document, in document order, a <template>'s content included. */
export function elementsOf(html: string): Element[] {
  const found: Element[] = [];
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue;
      found.push(child);
      walk(
        child.tagName === 'template' ? (child as DefaultTreeAdapterTypes.Template).content : child,
      );
    }
  };
  walk(parse(html));
  return found;
}

/** An attribute's value, or undefined when the element has none by that name. */
export const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((attr) => attr.name === name)?.value;

/** Whether an element's class list holds a class. */
export const hasClass = (element: Element, name: string): boolean =>
  (attribute(element, 'class') ?? '').split(/\s+/).includes(name);

/** Every element below one, in document order. */
export function descendants(element: Element): Element[] {
  const found: Element[] = [];
  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(element);
  return found;
}

/** An element as a short line for a failure message: its tag and its attributes. */
export const markupOf = (element: Element): string =>
  `<${element.tagName}${element.attrs.map((a) => ` ${a.name}="${a.value}"`).join('')}>`.slice(
    0,
    100,
  );
