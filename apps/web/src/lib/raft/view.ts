import { readLink, writeLink } from '../sim/link';
import { serverName, type Property } from './check';
import type { Server } from './core';
import {
  committedCount,
  currentTerm,
  leaderOf,
  leaders,
  replay,
  type Action,
  type Flight,
  type Sim,
} from './sim';

// What the Raft Lab draws, as markup and text, from a run's state. The page uses it twice: at
// build, to draw the opening run so the demo is complete without JavaScript, and in the browser,
// on every frame of a run (components/raft-lab/app.ts). Classes only, never a style attribute:
// the page's policy refuses inline styles. A visitor always reads "server", the glossary's word for
// Raft and the paper's; "node" in the code's fields and data-rf-node names the same thing, and no
// visitor reads it.

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

/**
 * What the run a visitor lands on goes on to do if it's left alone (ADR 0030), in virtual ms after
 * the opening: heartbeats alone tell nothing, so the leader crashes, the others elect a new one, the
 * old one comes back as a follower and hears it, and the new leader commits a write all five hold.
 * At Steady the crash comes 2 s in and the new leader 6 s in. On seed 7 a crash at 100 ms has one
 * server stand and win, where one at 200 ms splits the vote, which is a second story. One write and
 * no more, so each log stays on one line on a phone and it can go round again with nothing moving.
 */
export const LANDING = { crash: 100, restart: 500, write: 700, ends: 1_000 } as const;

/**
 * That story as a script for this run: the same actions a press records, so playing it is a run
 * replay rebuilds. It's the landing's alone. It isn't in OPENING, so the build's picture and a link's
 * run never hold it. A press drops what's left of it, and Start over on a run with no other press in
 * it tells it again (app.ts).
 */
export function landingStory(sim: Sim): { actions: Action[]; ends: number } {
  const leader = leaderOf(sim);
  if (!leader) return { actions: [], ends: Infinity };
  const { now } = sim;
  return {
    actions: [
      { at: now + LANDING.crash, kind: 'crash', node: leader.id },
      { at: now + LANDING.restart, kind: 'restart', node: leader.id },
      { at: now + LANDING.write, kind: 'write' },
    ],
    ends: now + LANDING.ends,
  };
}

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

/** How many seeded runs the property sweep in test/raft.test.ts makes: the page says the number. */
export const SEEDS_IN_CI = 3_000;

export const SIZE = 360;
/** The picture's frame: all of its width, and of its height what the fence and the words under the
 *  lower servers reach, so the empty 10 and 4 units over and under them aren't laid out. */
export const VIEW_BOX = `0 10 ${SIZE} 346`;
const CENTER = SIZE / 2;
const ORBIT = 128;
export const NODE_RADIUS = 27;
/** The election timer's dial, around the server. */
export const DIAL_RADIUS = NODE_RADIUS + 5;
/** Where a server's two lines of text sit: baselines below its centre (RaftLab.astro). */
export const ROLE_BASELINE = DIAL_RADIUS + 14;
export const TERM_BASELINE = DIAL_RADIUS + 26;

/** A server's place on the circle: server 1 at the top, then clockwise. */
export function place(id: number, size: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (id * 2 * Math.PI) / size;
  return { x: CENTER + ORBIT * Math.cos(angle), y: CENTER + ORBIT * Math.sin(angle) };
}

const round = (n: number) => Math.round(n * 10) / 10;

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** A server's state in words, for its button's name. */
export const serverState = (s: Server): string => (s.up ? `${s.role}, term ${s.term}` : 'down');

/** How far a follower's or candidate's election timer has run, 0 to 1; a leader's is full. */
export function timerShare(s: Server, now: number): number {
  if (!s.up) return 0;
  if (s.role === 'leader') return 1;
  return (now - s.timerStart) / (s.deadline - s.timerStart);
}

/** One server's log as a row of cells: filled when that server knows the entry is committed,
 *  outlined when not, term below. A crash clears what it knew (Figure 2's commitIndex is
 *  volatile), so a server that is down outlines every cell. */
export function logMarkup(s: Server): string {
  return s.log
    .map(
      (entry, i) =>
        `<li class="rf-cell"${i < s.commitIndex ? ' data-done=""' : ''}><span class="rf-mark"></span><span class="rf-num">${entry.term}</span></li>`,
    )
    .join('');
}

/** The same log said in words, for assistive technology and for the text it stands beside: what
 *  the server knows is committed, as its lamps draw it, so a server that is down knows of none. */
export function logWords(s: Server): string {
  if (s.log.length === 0) return 'empty log';
  return `${entries(s.log.length)}, ${s.commitIndex || 'none'} known committed, last of term ${s.log.at(-1)?.term}`;
}

/** Where a message is drawn, `share` of the way from its sender to its receiver. */
function along(f: Flight, size: number, share: number) {
  const a = place(f.message.from, size);
  const b = place(f.message.to, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // From one server's edge to the other's, not centre to centre.
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
      const share = still ? 0.5 : (sim.now - f.sent) / (f.arrives - f.sent);
      if (f.lost && share > 0.5) return '';
      const { x, y } = along(f, size, share);
      const dot = (kind: string, r: number) =>
        `<circle class="rf-m" data-kind="${kind}" cx="${x}" cy="${y}" r="${r}"/>`;
      const square = (kind: string, side: number) =>
        `<rect class="rf-m" data-kind="${kind}" x="${round(x - side / 2)}" y="${round(y - side / 2)}" width="${side}" height="${side}"/>`;
      const m = f.message;
      switch (m.kind) {
        case 'vote':
          return dot('vote', 4.5);
        case 'voted':
          return dot(m.granted ? 'yes' : 'no', 3.5);
        case 'append':
          return m.entries.length > 0 ? square('entries', 9) : square('beat', 6);
        case 'appended':
          return dot('ack', 2.5);
      }
    })
    .join('');
}

type Point = readonly [number, number];

/** How far the cut's fence keeps from what it closes in. */
export const CUT_PAD = 7;

/** What one server covers on the map, as points on its edge, grown by `pad`: the timer's dial with
 *  half its 3 px stroke, and the box of its two lines of text, as wide as "candidate", the longest
 *  role, and their 4 px halo. The text hangs below the server, so it is not round. */
export function footprint(id: number, size: number, pad: number): Point[] {
  const { x, y } = place(id, size);
  const dial = DIAL_RADIUS + 1.5 + pad;
  const points: Point[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16;
    points.push([x + dial * Math.cos(a), y + dial * Math.sin(a)]);
  }
  const half = 33 + pad;
  const top = y + ROLE_BASELINE - 11 - pad;
  const bottom = y + TERM_BASELINE + 5 + pad;
  points.push([x - half, top], [x + half, top], [x + half, bottom], [x - half, bottom]);
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

/** The fence that marks a split network: a dashed line around the side the page cuts off, side 1, a
 *  server or two neighbors (components/raft-lab/app.ts), drawn around what they cover, so it never
 *  crosses a server or its text. Null when the network is whole. A straight line between the sides
 *  cannot do this: a server's text reaches down beside its neighbors. */
export function cutFence(groups: readonly number[]): string | null {
  if (!groups.includes(1)) return null;
  const points = groups.flatMap((g, id) => (g ? footprint(id, groups.length, CUT_PAD) : []));
  return `M${hull(points)
    .map(([x, y]) => `${round(x)} ${round(y)}`)
    .join('L')}Z`;
}

/** What each safety property promises, in plain words, each close to Figure 3's own. The build
 *  draws them and they never change, so a browser never loads them. */
export const PROMISES: Readonly<Record<Property, string>> = {
  'Election Safety': 'At most one leader in a term.',
  'Leader Append-Only': 'A leader never overwrites or deletes its own entries.',
  'Log Matching': 'Logs with the same term at an index match up to it.',
  'Leader Completeness': 'A committed entry is in the log of every later leader.',
  'State Machine Safety': 'No two servers apply different entries at one index.',
};

/** A property's word beside its lamp: Held or Broken, the other labs' words, and nothing longer, so a
 *  row never takes another line. */
export const propertyWord = (held: boolean): string => (held ? 'Held' : 'Broken');

/** "249 events", for the clock, as every lab's says it. */
export const eventsWords = (sim: Sim): string => `${sim.events.toLocaleString('en-US')} events`;

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(3)} s`;

/**
 * A one-line summary of the cluster, for the picture's name. A leader cut off from the rest is still
 * drawn as a leader, since that's what it thinks it is, so the words say so as well, and the caption
 * never contradicts the picture above it. A term that had a leader and has it no more says so: "no
 * leader in term 1", right after "Server 1 leads term 1", read as false to the readers this page is
 * for. "No leader" is for a term nobody has won yet. The committed count is the run's high-water
 * mark, not what the servers remember now, so a crash can't take it down.
 */
export function summary(sim: Sim): string {
  const { leader, behind } = leaders(sim);
  const committed = committedCount(sim);
  const down = sim.servers.filter((s) => !s.up).length;
  const term = currentTerm(sim);
  const parts = [
    leader
      ? `${serverName(leader.id)} leads term ${leader.term}`
      : term > 0
        ? sim.checker.leaders.has(term)
          ? `Term ${term} lost its leader`
          : `No leader in term ${term}`
        : 'No leader',
    `${entries(committed)} committed`,
  ];
  if (down > 0) parts.push(`${down} ${down === 1 ? 'server' : 'servers'} down`);
  if (new Set(sim.groups).size > 1) parts.push('the network is split');
  const [old] = behind;
  const words = !old
    ? ''
    : behind.length > 1
      ? ` Servers ${behind.map((s) => s.id + 1).join(' and ')} still think they lead older terms.`
      : ` ${serverName(old.id)} still thinks it leads term ${old.term}.`;
  return `${parts.join(', ')}.${words}`;
}
