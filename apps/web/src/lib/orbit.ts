import { leaderOf } from './raft/sim';
import { openingRun } from './raft/view';

// The cluster Home's opening stands on: five servers on one ring, the leader's heartbeats running
// out to the rest, and beside each its log, a bead an entry. One geometry with two drawings, so the
// picture on the page (components/home/Orbit.astro) and the one on Home's link preview
// (lib/og-art.ts) can't disagree. Everything comes from the Raft Lab's opening run.

/** The drawing's own pixels: a square this wide, the ring at its centre. */
export const ORBIT_BOX = 400;
export const ORBIT_CENTRE = ORBIT_BOX / 2;
export const ORBIT_RADIUS = 156;

export interface OrbitServer {
  readonly id: number;
  readonly leader: boolean;
  readonly entries: number;
}

export type OrbitPoint = readonly [x: number, y: number];

export interface OrbitPlace {
  readonly server: OrbitServer;
  readonly k: number;
  readonly xy: OrbitPoint;
  /** Its log, a point an entry, in a row outward from the server along its spoke. */
  readonly beads: readonly OrbitPoint[];
}

/** The Raft Lab's opening run, as the cluster draws it. */
export function openingServers(): OrbitServer[] {
  const run = openingRun();
  const leader = leaderOf(run);
  return run.servers.map((server) => ({
    id: server.id,
    leader: server.id === leader?.id,
    entries: server.log.length,
  }));
}

/** A point on the ring's spoke k of `count`, `r` from the centre; spoke 0 stands at the top. */
export function orbitPoint(k: number, count: number, r = ORBIT_RADIUS): OrbitPoint {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / count;
  return [ORBIT_CENTRE + r * Math.cos(a), ORBIT_CENTRE + r * Math.sin(a)];
}

/** Every server's place on the ring, and each bead of its log. */
export function orbitPlaces(servers: readonly OrbitServer[]): OrbitPlace[] {
  return servers.map((server, k) => ({
    server,
    k,
    xy: orbitPoint(k, servers.length),
    beads: Array.from({ length: server.entries }, (_, i) =>
      orbitPoint(k, servers.length, ORBIT_RADIUS + 26 + i * 8),
    ),
  }));
}
