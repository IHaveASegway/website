import { describe, expect, test } from 'vitest';
import { BOARD_SCALE, LINE_SCALE, lineDrawing } from '../src/lib/og-lines';
import { hex, themeColors } from '../src/lib/tokens';
import tokensCss from '../src/styles/tokens.css?raw';
import { app, files } from './support/dist';
import { attribute, elementsOf } from './support/html';

// One model (lib/line-shapes.ts), drawn by the link previews into a PNG (lib/og-lines.ts): a lab's
// own card draws its line large, and Home's card draws every line at the board's size. Until
// ADR 0027 Home's board drew the same lines on the page, and this check held the page's drawing
// and the card's to each other; the board left Home with ADR 0027, so the check now reads every
// station back from both of the previews' drawings, the lab's card and Home's, and fails if they
// disagree on what each station shows: hollow, filled, lit, crossed, down, a lone dot (the Raft
// leader, a dead letter), or a buffer stop. Until 2026-10-31 the previews kept a hand copy of the
// board's shapes (5108b71); the shared model removed it.

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

const number = (value: string | undefined) => Number.parseFloat(value ?? 'NaN');

/** The centre of a crossed lamp, from its path: "M{x-d} {y-d}l{2d} {2d}...". */
function crossCentre(d: string): [number, number] {
  const [x = NaN, y = NaN, dx = NaN, dy = NaN] = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return [x + dx / 2, y + dy / 2];
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

/** The labs this build writes a page for, by slug: each has a line on its link preview. */
const LABS = files
  .map((file) => /^lab\/([a-z0-9-]+)\/index\.html$/.exec(file)?.[1])
  .filter((slug): slug is string => slug !== undefined);

const states = (list: readonly Station[]) => list.map((s) => s.state).sort();

describe("each lab's line on its card and on Home's card", () => {
  test('a line for every lab this build writes, on its own card', async () => {
    expect(LABS.length).toBeGreaterThan(0);
    for (const slug of LABS) expect(await lineDrawing(slug, LINE_SCALE, app), slug).toBeDefined();
  });

  for (const slug of LABS)
    test(`${slug}: its own card and Home's card draw the same stations, in the same states`, async () => {
      const own = await lineDrawing(slug, LINE_SCALE, app);
      const home = await lineDrawing(slug, BOARD_SCALE, app);
      if (!own || !home) throw new Error(`${slug} has no line on a card`);
      const large = stations(cardMarks(own));
      const small = stations(cardMarks(home));
      expect(large.length, `${slug}: the card has stations`).toBeGreaterThan(0);
      expect(states(small), slug).toEqual(states(large));
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
  // The states of two drawings compare as a list, whatever their order on the card.
  expect(states([...hollow(10), ...stations([mark('lit', 30)])])).toEqual(['hollow', 'lit']);
  expect(states(hollow(10))).not.toEqual(states(stations([mark('lit', 10)])));
  expect(crossCentre('M10 20l6 6m0 -6l-6 6')).toEqual([13, 23]);
});
