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

/** How many seeded runs the property sweep in test/raft.test.ts makes: the page says the number. */
export const SEEDS_IN_CI = 3_000;

export const SIZE = 360;
const CENTER = SIZE / 2;
const ORBIT = 128;
export const NODE_RADIUS = 27;

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

/** The chord that marks a cut network, between the two gaps where the sides meet on the circle,
 *  or null when the network is whole or the sides are not each one run of the circle. */
export function cutLine(
  groups: readonly number[],
): { x1: number; y1: number; x2: number; y2: number } | null {
  const size = groups.length;
  const gaps: number[] = [];
  for (let i = 0; i < size; i++) if (groups[i] !== groups[(i + 1) % size]) gaps.push(i);
  if (gaps.length !== 2) return null;
  const point = (gap: number) => {
    const angle = -Math.PI / 2 + ((gap + 0.5) * 2 * Math.PI) / size;
    return { x: round(CENTER + 168 * Math.cos(angle)), y: round(CENTER + 168 * Math.sin(angle)) };
  };
  const [a, b] = gaps.map(point) as [{ x: number; y: number }, { x: number; y: number }];
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
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
