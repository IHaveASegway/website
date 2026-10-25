// Writes the test inputs in test/fixtures/. Deterministic: same bytes
// every run (seeded PRNG, no clock). Synthetic points around a depot
// near Seattle; travel times come from straight-line distance with a
// road detour factor, so the matrices are symmetric stand-ins
// for real road matrices. They test the solver, not the map.
//
//   node test/gen-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(OUT, { recursive: true });

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEPOT = [-122.3321, 47.6062];

function points(rand, n, radiusKm) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r = radiusKm * Math.sqrt(rand());
    const a = 2 * Math.PI * rand();
    const dLat = (r * Math.sin(a)) / 111.32;
    const dLon = (r * Math.cos(a)) / (111.32 * Math.cos((DEPOT[1] * Math.PI) / 180));
    pts.push([DEPOT[0] + dLon, DEPOT[1] + dLat]);
  }
  return pts;
}

function haversineM([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// distances in metres (x1.3 detour), durations in seconds at a speed
// that depends on trip length (short trips are slower), so durations
// and distances are not proportional and the two objectives differ.
function matrices(locs, speedScale = 1) {
  const distances = locs.map((a) => locs.map((b) => Math.round(1.3 * haversineM(a, b))));
  const durations = distances.map((row) =>
    row.map((d) => {
      if (d === 0) return 0;
      const kmh = (d < 3000 ? 28 : d < 10000 ? 45 : 65) * speedScale;
      return Math.round(d / ((kmh * 1000) / 3600)) + 60;
    }),
  );
  return { durations, distances };
}

const H = 3600;
const write = (name, obj) => writeFileSync(join(OUT, `${name}.json`), JSON.stringify(obj) + '\n');

// 1. One van, 12 stops, durations only: VROOM's TSP path.
{
  const rand = mulberry32(1);
  const locs = [DEPOT, ...points(rand, 12, 12)];
  const { durations } = matrices(locs);
  write('01-tsp-12', {
    vehicles: [{ id: 1, start_index: 0, end_index: 0 }],
    jobs: locs.slice(1).map((_, i) => ({ id: 101 + i, location_index: i + 1, service: 180 })),
    matrices: { car: { durations } },
  });
}

// 2. Two vans with capacity, 20 stops, durations and distances.
{
  const rand = mulberry32(2);
  const locs = [DEPOT, ...points(rand, 20, 15)];
  const m = matrices(locs);
  write('02-cvrp-20x2', {
    vehicles: [1, 2].map((id) => ({ id, start_index: 0, end_index: 0, capacity: [24] })),
    jobs: locs.slice(1).map((_, i) => ({
      id: 201 + i,
      location_index: i + 1,
      service: 120 + Math.floor(rand() * 4) * 60,
      delivery: [1 + Math.floor(rand() * 3)],
    })),
    matrices: { car: m },
  });
}

// 3. Three vans, time windows, capacities, service times: the
//    case the demo is built on.
{
  const rand = mulberry32(3);
  const locs = [DEPOT, ...points(rand, 25, 18)];
  const m = matrices(locs);
  write('03-vrptw-25x3', {
    vehicles: [1, 2, 3].map((id) => ({
      id,
      start_index: 0,
      end_index: 0,
      capacity: [12],
      time_window: [7 * H, 13 * H],
    })),
    jobs: locs.slice(1).map((_, i) => {
      const job = {
        id: 301 + i,
        location_index: i + 1,
        service: 180 + Math.floor(rand() * 5) * 60,
        delivery: [1 + Math.floor(rand() * 2)],
      };
      if (rand() < 0.6) {
        const start = 7 * H + Math.floor(rand() * 8) * 1800;
        job.time_windows = [[start, start + 2 * H]];
      }
      return job;
    }),
    matrices: { car: m },
  });
}

// 4. Shipments (pickup then delivery), breaks, skills, priorities,
//    max_tasks, per-vehicle costs.
{
  const rand = mulberry32(4);
  const locs = [DEPOT, ...points(rand, 20, 14)];
  const m = matrices(locs);
  write('04-shipments-breaks', {
    vehicles: [
      {
        id: 1,
        start_index: 0,
        end_index: 0,
        capacity: [6, 2],
        skills: [1],
        time_window: [8 * H, 16 * H],
        breaks: [{ id: 91, service: 1800, time_windows: [[11 * H, 13 * H]] }],
        costs: { fixed: 600, per_hour: 3600 },
        max_tasks: 14,
      },
      {
        id: 2,
        start_index: 0,
        end_index: 0,
        capacity: [8, 0],
        time_window: [8 * H, 16 * H],
        breaks: [{ id: 92, service: 1800, time_windows: [[11 * H, 13 * H]] }],
        costs: { fixed: 0, per_hour: 3000, per_km: 200 },
      },
    ],
    jobs: Array.from({ length: 8 }, (_, i) => ({
      id: 401 + i,
      location_index: 13 + i,
      service: 300,
      delivery: [1, i % 4 === 0 ? 1 : 0],
      skills: i % 4 === 0 ? [1] : [],
      priority: i % 3 === 0 ? 50 : 0,
    })),
    shipments: Array.from({ length: 6 }, (_, i) => ({
      amount: [1, 0],
      pickup: { id: 451 + i, location_index: 1 + 2 * i, service: 240 },
      delivery: { id: 461 + i, location_index: 2 + 2 * i, service: 240 },
    })),
    matrices: { car: m },
  });
}

// 5. Not everything fits: tight capacity and windows leave jobs
//    unassigned; two profiles with different matrices; vehicles
//    starting at different places and ending elsewhere.
{
  const rand = mulberry32(5);
  const locs = [DEPOT, ...points(rand, 2, 6), ...points(rand, 30, 20)];
  const car = matrices(locs);
  const bike = matrices(locs, 0.4);
  write('05-unassigned-profiles', {
    vehicles: [
      {
        id: 1,
        profile: 'car',
        start_index: 0,
        end_index: 1,
        capacity: [10],
        time_window: [9 * H, 12 * H],
      },
      {
        id: 2,
        profile: 'car',
        start_index: 2,
        end_index: 0,
        capacity: [10],
        time_window: [9 * H, 12 * H],
      },
      { id: 3, profile: 'bike', start_index: 0, capacity: [4], time_window: [9 * H, 11 * H] },
    ],
    jobs: locs.slice(3).map((_, i) => ({
      id: 501 + i,
      location_index: i + 3,
      service: 240,
      delivery: [1 + (i % 2)],
      time_windows: [[9 * H + (i % 4) * 2700, 9 * H + (i % 4) * 2700 + 5400]],
    })),
    matrices: { car, bike },
  });
}

// Benchmarks: the sizes the demo page will send.
function bench(name, seed, nJobs, nVehicles, radiusKm) {
  const rand = mulberry32(seed);
  const locs = [DEPOT, ...points(rand, nJobs, radiusKm)];
  const m = matrices(locs);
  write(name, {
    vehicles: Array.from({ length: nVehicles }, (_, i) => ({
      id: i + 1,
      start_index: 0,
      end_index: 0,
      capacity: [Math.ceil((nJobs * 1.6) / nVehicles) + 2],
      time_window: [6 * H, 14 * H],
    })),
    jobs: locs.slice(1).map((_, i) => {
      const job = {
        id: 1000 + i,
        location_index: i + 1,
        service: 240,
        delivery: [1 + Math.floor(rand() * 2)],
      };
      if (rand() < 0.5) {
        const start = 6 * H + Math.floor(rand() * 10) * 1800;
        job.time_windows = [[start, start + 3 * H]];
      }
      return job;
    }),
    matrices: { car: m },
  });
}
bench('bench-25x3', 25, 25, 3, 20);
bench('bench-60x4', 60, 60, 4, 25);
// Large input: a 201 x 201 matrix (about 0.5 MB of JSON) to exercise
// heap growth and the string hand-off. verify.mjs runs it at x=0 only.
bench('big-200x8', 200, 200, 8, 30);

// Error paths: what the browser gets back instead of a crash.
write('err-coordinates-only', {
  vehicles: [{ id: 1, start: DEPOT, end: DEPOT }],
  jobs: [{ id: 1, location: [-122.3, 47.62] }],
});
write('err-matrix-too-small', {
  vehicles: [{ id: 1, start_index: 0 }],
  jobs: [{ id: 1, location_index: 5 }],
  matrices: {
    car: {
      durations: [
        [0, 1],
        [1, 0],
      ],
    },
  },
});
writeFileSync(join(OUT, 'err-not-json.json'), '{ this is not json\n');

console.log('fixtures written to', OUT);
