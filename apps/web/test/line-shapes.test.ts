import { describe, expect, test } from 'vitest';
import { BOARD_SCALE, LINE_SCALE, lineDrawing } from '../src/lib/og-lines';
import { OG_SIZE } from '../src/lib/og';
import { hex, themeColors } from '../src/lib/tokens';
import tokensCss from '../src/styles/tokens.css?raw';
import { app, read } from './support/dist';
import { attribute, descendants, elementsOf, hasClass, type Element } from './support/html';

// One model, two renderers (lib/line-shapes.ts): Home's board draws each lab's line from it as
// SVG on the page, and the link previews draw the board's wide size from it, scaled, into a PNG
// (lib/og-lines.ts). Until 2026-10-31 the previews kept a hand copy of the board's shapes, and
// when the board's lines changed the cards did not, until a merge patched the copy (5108b71: a
// downed worker and the Raft log's buffer stop). The shared model removes the copy; this check
// holds the two renderers to it. It reads every station back from both drawings, as each one
// draws it, the board from dist/index.html and the card from its SVG, and fails if they disagree
// on a station's place or its lamp: hollow, filled, lit, crossed, down, a lone dot (the Raft
// leader, a dead letter), or a buffer stop.

/** What a station shows, read from its marks. */
type State = 'hollow' | 'filled' | 'lit' | 'cross' | 'down' | 'dot' | 'stop';

interface Station {
  readonly state: State;
  /** On the card, in its pixels: the board's are converted (below). */
  readonly x: number;
  readonly y: number;
  /** Where a downed station's hollow ends. */
  readonly to?: number;
}

/** A mark before the marks at one place are read together as a station. */
type Mark = Station & { readonly kind: 'rim' | 'dot' | 'lit' | 'cross' | 'down' | 'stop' };

/** The board's lengths are pixels or shares of the width ("56%"), and an inner <svg x="74%">
 *  moves what it holds; on the card a share is of the card's width and a pixel is `scale` card
 *  pixels (lib/og-lines.ts, the pen). */
function boardLength(value: string | undefined, scale: number): number {
  const text = value ?? '0';
  return text.endsWith('%')
    ? (Number.parseFloat(text) / 100) * OG_SIZE.width
    : Number.parseFloat(text) * scale;
}

const number = (value: string | undefined) => Number.parseFloat(value ?? 'NaN');

/** The centre of a crossed lamp, from its path: "M{x-d} {y-d}l{2d} {2d}...". */
function crossCentre(d: string): [number, number] {
  const [x = NaN, y = NaN, dx = NaN, dy = NaN] = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return [x + dx / 2, y + dy / 2];
}

/** The marks the board's wide drawing of a line shows, as lines.css draws them still: a filled
 *  lamp's fill only with data-lit, a van's lamp only with data-here. */
function boardMarks(drawing: Element, scale: number): Mark[] {
  const marks: Mark[] = [];
  const walk = (element: Element, left: number) => {
    for (const child of element.childNodes) {
      if (!('tagName' in child)) continue;
      const at = (name: string) => left + boardLength(attribute(child, name), scale);
      const cy = number(attribute(child, 'cy')) * scale;
      const lamp = (kind: Mark['kind']) =>
        marks.push({ kind, state: 'hollow', x: at('cx'), y: cy });
      if (child.tagName === 'svg') walk(child, at('x'));
      else if (child.tagName === 'g') walk(child, left);
      else if (child.tagName === 'circle') {
        if (hasClass(child, 'line-lamp')) lamp('rim');
        else if (hasClass(child, 'line-lamp-lit') && attribute(child, 'data-lit') !== undefined)
          lamp('dot');
        else if (hasClass(child, 'line-hub')) lamp('dot');
        else if (hasClass(child, 'line-now')) lamp('lit');
        else if (hasClass(child, 'line-van-at') && attribute(child, 'data-here') !== undefined)
          lamp('lit');
      } else if (child.tagName === 'line' && hasClass(child, 'line-gap'))
        marks.push({
          kind: 'down',
          state: 'down',
          x: at('x1'),
          y: number(attribute(child, 'y1')) * scale,
          to: at('x2'),
        });
      else if (child.tagName === 'path' && hasClass(child, 'line-cross')) {
        const [x, y] = crossCentre(attribute(child, 'd') ?? '');
        marks.push({ kind: 'cross', state: 'cross', x: left + x * scale, y: y * scale });
      } else if (child.tagName === 'rect' && hasClass(child, 'line-depot')) {
        const width = number(attribute(child, 'width')) * scale;
        const height = number(attribute(child, 'height')) * scale;
        marks.push({
          kind: 'stop',
          state: 'stop',
          x: at('x') + width / 2,
          y: number(attribute(child, 'y')) * scale + height / 2,
        });
      }
    }
  };
  walk(drawing, 0);
  return marks;
}

/** The night theme's ground, which the card draws a hollow lamp's middle and a downed track in. */
const background = themeColors(tokensCss, 'dark').get('background');
if (!background) throw new Error('tokens.css has no --background');
const ground = hex(background);

/** The marks a card's drawing of a line shows (lib/og-lines.ts, lamp, gap, disc, square). */
function cardMarks(svg: string): Mark[] {
  const marks: Mark[] = [];
  for (const element of elementsOf(svg)) {
    const fill = attribute(element, 'fill');
    const stroke = attribute(element, 'stroke');
    if (element.tagName === 'circle' && fill !== 'none') {
      const kind = stroke === undefined ? 'dot' : fill === ground ? 'rim' : 'lit';
      const x = number(attribute(element, 'cx'));
      marks.push({ kind, state: 'hollow', x, y: number(attribute(element, 'cy')) });
    } else if (element.tagName === 'line' && stroke === ground)
      marks.push({
        kind: 'down',
        state: 'down',
        x: number(attribute(element, 'x1')),
        y: number(attribute(element, 'y1')),
        to: number(attribute(element, 'x2')),
      });
    else if (element.tagName === 'path' && attribute(element, 'stroke-linecap') === 'square') {
      const [x, y] = crossCentre(attribute(element, 'd') ?? '');
      marks.push({ kind: 'cross', state: 'cross', x, y });
    } else if (element.tagName === 'rect')
      marks.push({
        kind: 'stop',
        state: 'stop',
        x: number(attribute(element, 'x')) + number(attribute(element, 'width')) / 2,
        y: number(attribute(element, 'y')) + number(attribute(element, 'height')) / 2,
      });
  }
  return marks;
}

/** Marks within this many card pixels are one station: the card draws to a hundredth. */
const NEAR = 0.5;

/** The stations the marks make, top to bottom: a rim with a dot in it is filled, with a cross
 *  crossed, alone hollow; a lit lamp over a rim is lit (a van at a stop); a dot alone is a dot. */
function stations(marks: readonly Mark[]): Station[] {
  const groups: Mark[][] = [];
  for (const mark of marks) {
    if (mark.kind === 'down' || mark.kind === 'stop') {
      groups.push([mark]);
      continue;
    }
    const near = groups.find(
      ([first]) =>
        first !== undefined &&
        first.kind !== 'down' &&
        first.kind !== 'stop' &&
        Math.abs(first.x - mark.x) < NEAR &&
        Math.abs(first.y - mark.y) < NEAR,
    );
    if (near) near.push(mark);
    else groups.push([mark]);
  }
  const read = (group: readonly Mark[]): Station => {
    const [first] = group as [Mark];
    const kinds = new Set(group.map((m) => m.kind));
    const state: State =
      first.kind === 'down' || first.kind === 'stop'
        ? first.state
        : kinds.has('lit')
          ? 'lit'
          : kinds.has('cross')
            ? 'cross'
            : kinds.has('rim')
              ? kinds.has('dot')
                ? 'filled'
                : 'hollow'
              : 'dot';
    return { state, x: first.x, y: first.y, ...(first.to === undefined ? {} : { to: first.to }) };
  };
  return groups.map(read).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A station as a line of the failure message, to the card's nearest pixel. */
const told = (s: Station) =>
  `${s.state} at ${Math.round(s.x)},${Math.round(s.y)}${s.to === undefined ? '' : ` to ${Math.round(s.to)}`}`;

/** Whether two stations are the same: one state, within NEAR of each other. */
const same = (a: Station, b: Station) =>
  a.state === b.state &&
  Math.abs(a.x - b.x) < NEAR &&
  Math.abs(a.y - b.y) < NEAR &&
  Math.abs((a.to ?? 0) - (b.to ?? 0)) < NEAR;

/** What one reading has that the other lacks, each station matched once: both empty when the
 *  board and the card agree. */
function apart(board: readonly Station[], card: readonly Station[]) {
  const left = [...card];
  const boardOnly = board.filter((b) => {
    const i = left.findIndex((c) => same(b, c));
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  return { boardOnly: boardOnly.map(told), cardOnly: left.map(told) };
}

/** Each band of Home's board: its lab, and its line's wide drawing. */
const bands = elementsOf(read('index.html'))
  .filter((element) => element.tagName === 'li' && hasClass(element, 'band'))
  .map((band) => ({
    slug: attribute(band, 'data-line') ?? '',
    drawing: descendants(band).find(
      (element) =>
        element.tagName === 'svg' &&
        hasClass(element, 'line-draw') &&
        hasClass(element, 'line-wide'),
    ),
  }));

describe("each lab's line on its card and on Home's board", () => {
  test('Home draws a band per lab, each with a wide drawing', () => {
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) expect(band.drawing, band.slug).toBeDefined();
  });

  for (const { slug, drawing } of bands)
    for (const [where, scale] of [
      ['its own card', LINE_SCALE],
      ["Home's and the Lab index's cards", BOARD_SCALE],
    ] as const)
      test(`${slug}: ${where} put the same stations, in the same states, where the board does`, async () => {
        if (!drawing) throw new Error(`${slug} has no wide drawing on the board`);
        const svg = await lineDrawing(slug, scale, app);
        if (!svg) throw new Error(`${slug} has no line on its card`);
        const board = stations(boardMarks(drawing, scale));
        const card = stations(cardMarks(svg));
        expect(board.length, `${slug}: the board has stations`).toBeGreaterThan(0);
        expect(apart(board, card), `${slug}: stations on one drawing and not the other`).toEqual({
          boardOnly: [],
          cardOnly: [],
        });
      });
});

test('known answers: marks at one place read as one station', () => {
  const mark = (kind: Mark['kind'], x: number, y = 10): Mark => ({ kind, state: 'hollow', x, y });
  expect(
    stations([
      mark('rim', 10),
      mark('dot', 10.2),
      mark('rim', 30),
      mark('cross', 50),
      mark('rim', 50),
    ]),
  ).toEqual([
    { state: 'filled', x: 10, y: 10 },
    { state: 'hollow', x: 30, y: 10 },
    { state: 'cross', x: 50, y: 10 },
  ]);
  expect(stations([mark('rim', 10), mark('lit', 10), mark('dot', 40)])).toEqual([
    { state: 'lit', x: 10, y: 10 },
    { state: 'dot', x: 40, y: 10 },
  ]);
  const hollow = (x: number) => stations([mark('rim', x)]);
  expect(apart(hollow(10), hollow(10.4))).toEqual({ boardOnly: [], cardOnly: [] });
  expect(apart(hollow(10), hollow(11))).toEqual({
    boardOnly: ['hollow at 10,10'],
    cardOnly: ['hollow at 11,10'],
  });
  expect(apart(hollow(10), stations([mark('lit', 10)]))).toEqual({
    boardOnly: ['hollow at 10,10'],
    cardOnly: ['lit at 10,10'],
  });
  expect(boardLength('50%', 2)).toBe(OG_SIZE.width / 2);
  expect(boardLength('7', 2)).toBe(14);
  expect(crossCentre('M10 20l6 6m0 -6l-6 6')).toEqual([13, 23]);
});
