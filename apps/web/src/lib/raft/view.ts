import { readLink, writeLink } from '../sim/link';
import type { Server } from './core';
import { leaderOf, replay, type Action, type Flight, type Sim } from './sim';

// What the Raft Lab draws, as markup and text, from a run's state. The page uses it twice: at
// build, to draw the opening run so the demo is complete without JavaScript, and in the browser,
// on every frame of a run (components/raft-lab/app.ts). Classes only, never a style attribute:
// the page's policy refuses inline styles.

/** The opening: a seed, and the writes a client made, so the page opens with a leader and a
 *  short committed log. The browser replays it to take over exactly where the picture stands. */
export const OPENING = {
  seed: 7,
  actions: [
    { at: 700, kind: 'write' },
    { at: 900, kind: 'write' },
    { at: 1_100, kind: 'write' },
  ] as readonly Action[],
  until: 1_400,
} as const;

export const openingRun = (): Sim => replay({ seed: OPENING.seed }, OPENING.actions, OPENING.until);

/** The shares of messages lost the page's slider offers, in percent: 0 to 50 in steps of 5. */
export const LOSSES: readonly number[] = Array.from({ length: 11 }, (_, i) => i * 5);

/**
 * The settings a link to a run names (lib/sim/link.ts), as the other simulated labs' do: the share
 * of messages lost from the opening's moment on, in percent, as the slider sets it. A run started
 * over with 30% lost is #seed-8&loss=30, so the link opens that run and not the one without loss.
 * The speed is not a setting: it changes how fast a run plays, never the run.
 */
export const SETTINGS = { loss: { values: LOSSES, opening: 0 } } as const;

/** The link to a run: its seed, and its loss when it loses messages (#seed-8&loss=30). */
export const linkTo = (seed: number, loss: number): string => writeLink(seed, { loss }, SETTINGS);

/** The run a link names, its seed and its loss in percent; null when the hash names no run. */
export const readRun = (hash: string): { seed: number; loss: number } | null => {
  const link = readLink(hash, SETTINGS);
  return link && { seed: link.seed, loss: link.values.loss };
};

/** Start over's seed: the next one, and 0 after the last a link can name, six digits' worth. */
export const nextSeed = (seed: number): number => (seed >= 999_999 ? 0 : seed + 1);

/** How many seeded runs the property sweep in test/raft.test.ts makes: the page says the number. */
export const SEEDS_IN_CI = 3_000;

export const SIZE = 360;
const CENTER = SIZE / 2;
const ORBIT = 128;
export const NODE_RADIUS = 27;
/** The election timer's dial, around the node. */
export const DIAL_RADIUS = NODE_RADIUS + 5;
/** Where a node's two lines of text sit: baselines below its centre (RaftLab.astro). */
export const ROLE_BASELINE = DIAL_RADIUS + 14;
export const TERM_BASELINE = DIAL_RADIUS + 26;

/** A node's place on the circle: node 1 at the top, then clockwise. */
export function place(id: number, size: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (id * 2 * Math.PI) / size;
  return { x: CENTER + ORBIT * Math.cos(angle), y: CENTER + ORBIT * Math.sin(angle) };
}

const round = (n: number) => Math.round(n * 10) / 10;

export const ROLE_WORD = {
  follower: 'follower',
  candidate: 'candidate',
  leader: 'leader',
} as const;

/** A node's one-line state, for its button and the picture's text. */
export function nodeText(s: Server): string {
  return s.up ? `Node ${s.id + 1}, ${ROLE_WORD[s.role]}, term ${s.term}` : `Node ${s.id + 1}, down`;
}

/** What pressing a node's button does. */
export const nodeAction = (s: Server): string =>
  s.up ? 'Press to crash it.' : 'Press to restart it.';

/** How far a follower's or candidate's election timer has run, 0 to 1; a leader's is full. */
export function timerShare(s: Server, now: number): number {
  if (!s.up) return 0;
  if (s.role === 'leader') return 1;
  const span = s.deadline - s.timerStart;
  return span > 0 ? Math.max(0, Math.min(1, (now - s.timerStart) / span)) : 0;
}

/** Terms take the map's four van colors in turn, so neighbouring terms always differ. A state the
 *  browser sets is an attribute, never a class: every class the stylesheet styles is one a built
 *  page carries (test/css-classes.test.ts). */
export const termShade = (term: number): number => (((term - 1) % 4) + 4) % 4;

/** One node's log as a row of cells: filled when committed, outlined when not, term below. */
export function logMarkup(s: Server): string {
  const cells = s.log
    .map((entry, i) => {
      const committed = i < s.commitIndex;
      return `<li class="rf-cell" data-term="${termShade(entry.term)}"${committed ? ' data-done=""' : ''}><span class="rf-mark"></span><span class="rf-num">${entry.term}</span></li>`;
    })
    .join('');
  return cells;
}

/** The same log said in words, for assistive technology and for the text it stands beside. */
export function logWords(s: Server): string {
  if (s.log.length === 0) return 'empty log';
  const committed = s.commitIndex > 0 ? `, ${s.commitIndex} committed` : ', none committed';
  return `${s.log.length} ${s.log.length === 1 ? 'entry' : 'entries'}${committed}, last of term ${s.log.at(-1)?.term}`;
}

/** Where a message is drawn, `share` of the way from its sender to its receiver. */
function along(f: Flight, size: number, share: number) {
  const a = place(f.message.from, size);
  const b = place(f.message.to, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // From one node's edge to the other's, not centre to centre.
  const start = NODE_RADIUS / length;
  const t = start + (1 - 2 * start) * share;
  return { x: round(a.x + dx * t), y: round(a.y + dy * t) };
}

/** Every message on the wire, as SVG: a dot or a square by kind, gliding, or at its midpoint for
 *  a visitor who asks for reduced motion. A lost message vanishes half way. */
export function flightsMarkup(sim: Sim, still: boolean): string {
  const size = sim.servers.length;
  return sim.flights
    .map((f) => {
      const span = f.arrives - f.sent || 1;
      const share = still ? 0.5 : Math.max(0, Math.min(1, (sim.now - f.sent) / span));
      if (f.lost && share > 0.5) return '';
      const { x, y } = along(f, size, share);
      const m = f.message;
      switch (m.kind) {
        case 'vote':
          return `<circle class="rf-m" data-kind="vote" cx="${x}" cy="${y}" r="4.5"/>`;
        case 'voted':
          return `<circle class="rf-m" data-kind="${m.granted ? 'yes' : 'no'}" cx="${x}" cy="${y}" r="3.5"/>`;
        case 'append':
          return m.entries.length > 0
            ? `<rect class="rf-m" data-kind="entries" x="${round(x - 4.5)}" y="${round(y - 4.5)}" width="9" height="9"/>`
            : `<rect class="rf-m" data-kind="beat" x="${round(x - 3)}" y="${round(y - 3)}" width="6" height="6"/>`;
        case 'appended':
          return `<circle class="rf-m" data-kind="ack" cx="${x}" cy="${y}" r="2.5"/>`;
      }
    })
    .join('');
}

type Point = readonly [number, number];

/** How far the cut's fence keeps from what it closes in. */
export const CUT_PAD = 7;

/** What one node covers on the map, as points on its edge, grown by `pad`: the timer's dial with
 *  half its 3 px stroke, and the box of its two lines of text, as wide as "candidate", the longest
 *  role, and their 4 px halo. The text hangs below the node, so a node is not round. */
export function footprint(id: number, size: number, pad: number): Point[] {
  const { x, y } = place(id, size);
  const dial = DIAL_RADIUS + 1.5 + pad;
  const points: Point[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16;
    points.push([x + dial * Math.cos(a), y + dial * Math.sin(a)]);
  }
  const half = 33;
  const top = y + ROLE_BASELINE - 11;
  const bottom = y + TERM_BASELINE + 5;
  const corners: [number, number, number][] = [
    [x - half, top, Math.PI],
    [x + half, top, -Math.PI / 2],
    [x + half, bottom, 0],
    [x - half, bottom, Math.PI / 2],
  ];
  for (const [cx, cy, from] of corners)
    for (let i = 0; i <= 4; i++) {
      const a = from + (i * Math.PI) / 8;
      points.push([cx + pad * Math.cos(a), cy + pad * Math.sin(a)]);
    }
  return points;
}

/** The convex hull of some points, clockwise on screen (Andrew's monotone chain). */
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0)
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** The fence that marks a cut network: a dashed line around the smaller side, drawn around what
 *  its nodes cover, so it never crosses a node or its text. Null when the network is whole or the
 *  sides are not each one run of the circle. A straight line between the sides cannot do this:
 *  a node's text reaches down beside its neighbours. */
export function cutFence(groups: readonly number[]): string | null {
  const size = groups.length;
  let gaps = 0;
  for (let i = 0; i < size; i++) if (groups[i] !== groups[(i + 1) % size]) gaps++;
  if (gaps !== 2) return null;
  const count = (g: number) => groups.filter((x) => x === g).length;
  const smaller = [...new Set(groups)].sort((a, b) => count(a) - count(b))[0];
  const points = groups.flatMap((g, id) => (g === smaller ? footprint(id, size, CUT_PAD) : []));
  return `M${hull(points)
    .map(([x, y]) => `${round(x)} ${round(y)}`)
    .join('L')}Z`;
}

/** The status line: the five properties held, or the one that broke, and where. */
export function statusText(sim: Sim): string {
  if (sim.violation)
    return `Broken at ${seconds(sim.violation.at)}: ${sim.violation.property}. ${sim.violation.detail}.`;
  return `All five safety properties held over ${sim.events.toLocaleString('en-US')} events.`;
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(3)} s`;

/** A one-line summary of the cluster, for the picture's name. */
export function summary(sim: Sim): string {
  const leader = leaderOf(sim);
  const committed = Math.max(0, ...sim.servers.map((s) => s.commitIndex));
  const down = sim.servers.filter((s) => !s.up).length;
  const parts = [
    leader ? `Node ${leader.id + 1} leads term ${leader.term}` : 'No leader',
    `${committed} ${committed === 1 ? 'entry' : 'entries'} committed`,
  ];
  if (down > 0) parts.push(`${down} ${down === 1 ? 'node' : 'nodes'} down`);
  if (new Set(sim.groups).size > 1) parts.push('the network is split');
  return `${parts.join(', ')}.`;
}
