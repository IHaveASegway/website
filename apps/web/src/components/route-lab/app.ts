import type { RouteData } from '../../lib/route-lab/data';
import { days } from '../../lib/route-lab/days';
import { decodeLegs } from '../../lib/route-lab/legs';
import {
  capacityFor,
  dealtInTurn,
  explorationFor,
  fromVroom,
  measure,
  solveTime,
  vroomInput,
  formatDuration,
  type Measured,
  type Plan,
  type VroomOutput,
} from '../../lib/route-lab/plan';
import {
  backLine,
  backText,
  mapTitle,
  placesMarkup,
  planLine,
  roomText,
  routesMarkup,
  savedText,
  tableMarkup,
  tipLines,
  vansUsed,
} from '../../lib/route-lab/render';
import type { Nearest } from './boot';

// The Route Lab in the browser, loaded when a visitor shows intent (boot.ts). The controls and the
// map are the state: which day, how many vans, which places have an order and in what order they
// came in. Every change redraws the dealt-in-turn plan at once, and VROOM plans the same orders
// again a moment later, in a module Web Worker that runs the WebAssembly build beside the page
// (ADR 0016). One solve runs at a time: changes made during it are planned once it answers, as
// one; a solve that has not answered in 15 s is stopped. Each change and VROOM's answer are said
// in one line, on screen and to assistive technology. Nothing is stored and nothing is sent
// anywhere: the only requests are the route data and the solver's own files.

const FAILED =
  'This browser could not run the solver. VROOM’s plan on the map is the last one it made.';
const LOADING = 'Loading the solver…';
const NONE = 'Add at least one order to plan a route.';
/** How long a change waits for the next before VROOM plans, so a run of taps is one solve. */
const SETTLE_MS = 150;
/** How long a solve may run before the page gives up on the solver. */
const LIMIT_MS = 15_000;

interface Solved {
  readonly key: string;
  readonly orders: readonly number[];
  readonly vans: number;
  readonly plan: Plan;
  readonly measured: Measured;
}

const keyOf = (orders: readonly number[], vans: number) =>
  `${vans}|${[...orders].sort((a, b) => a - b).join(',')}`;

const join = (...parts: string[]) => parts.filter(Boolean).join(' ');

export async function start(root: HTMLElement, queued: Element[], nearest: Nearest): Promise<void> {
  const $ = <T extends Element>(selector: string, within: ParentNode = root) =>
    within.querySelector<T>(selector);
  const all = <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)];
  const text = (node: Element | null, value: string) => {
    if (node) node.textContent = value;
  };
  /** The line under the readout, and the same with what VROOM saves, for assistive technology. */
  const say = (shown: string, spoken = shown) => {
    text($('[data-rl-status]'), shown);
    text($('[data-rl-say]'), spoken);
  };

  const data = (await (await fetch(root.dataset['rlData'] ?? '')).json()) as RouteData;
  const leg = decodeLegs(data.legs);
  const DAYS = days(data);
  const bands = root.dataset['rlBands'] ?? '';
  const name = (place: number) => data.points[place]?.label ?? '';

  const dayRadios = all<HTMLInputElement>('input[name="rl-day"]');
  const vanRadios = all<HTMLInputElement>('input[name="rl-vans"]');
  const boxes = all<HTMLInputElement>('input[name="rl-order"]');
  const figure = (which: string) => $<HTMLElement>(`[data-rl-plan="${which}"]`);

  // The state, read from the controls as they stand: the visitor may have changed them while this
  // module loaded. The day's own order comes first, then any place ticked since, in list order.
  let vans = Number(vanRadios.find((r) => r.checked)?.value ?? 1);
  const day = DAYS.find((d) => d.id === dayRadios.find((r) => r.checked)?.value);
  const ticked = boxes.filter((b) => b.checked).map((b) => Number(b.value));
  let orders = [
    ...(day?.orders ?? []).filter((o) => ticked.includes(o)),
    ...ticked.filter((o) => !day?.orders.includes(o)),
  ];

  const first = JSON.parse(root.dataset['rlSolved'] ?? '{}') as {
    vans: number;
    orders: number[];
    routes: number[][];
  };
  const solvedFor = (o: readonly number[], v: number, plan: Plan): Solved => ({
    key: keyOf(o, v),
    orders: o,
    vans: v,
    plan,
    measured: measure(data, plan),
  });
  let solved = solvedFor(first.orders, first.vans, { routes: first.routes, unassigned: [] });
  let dealt: Plan = { routes: [], unassigned: [] };
  const fresh = () => solved.key === keyOf(orders, vans);
  /** What the last change did, said with VROOM's answer to it. */
  let note = '';

  // The solver: one worker, made on the first solve, and at most one request in flight.
  let worker: Worker | null = null;
  let broken = false;
  let answered = false;
  let asked = 0;
  let busy: { id: number; orders: number[]; vans: number; limit: number; slow: number } | null =
    null;
  let settle: number | undefined;

  function draw(
    which: 'before' | 'after',
    plan: Plan,
    measured: Measured,
    count: number,
    n: number,
  ) {
    const fig = figure(which);
    if (!fig) return;
    const routes = $('[data-rl-routes]', fig);
    const places = $('[data-rl-places]', fig);
    if (routes) routes.innerHTML = routesMarkup(leg, plan);
    if (places) places.innerHTML = placesMarkup(data, plan);
    text($('[data-rl-time]', fig), formatDuration(measured.drive));
    text($('[data-rl-line]', fig), planLine(plan, measured));
    text($('[data-rl-back]', fig), backLine(measured));
    text($('title', fig), mapTitle(which, count, n, bands));
  }

  function table(which: 'before' | 'after', measured: Measured, caption: string) {
    const holder = $(`[data-rl-table="${which}"]`);
    if (holder) holder.innerHTML = tableMarkup(data, measured, caption);
  }

  /** Redraws everything that follows from the controls: the dealt-in-turn plan, and whether
   *  VROOM's plan on show is for these orders. */
  function update() {
    const capacity = capacityFor(data, orders, vans);
    dealt = dealtInTurn(data, orders, vans, capacity);
    const measured = measure(data, dealt);
    draw('before', dealt, measured, orders.length, vans);
    table('before', measured, 'As the orders came in');
    const isFresh = fresh();
    const after = figure('after');
    after?.toggleAttribute('data-rl-stale', !isFresh);
    $('[data-rl-readout]')?.toggleAttribute('data-rl-stale', !isFresh);
    const stale = after && $<HTMLElement>('[data-rl-note]', after);
    if (stale) stale.hidden = isFresh;
    if (after)
      text(
        $('title', after),
        mapTitle('after', solved.orders.length, solved.vans, bands, !isFresh),
      );
    table(
      'after',
      solved.measured,
      isFresh ? 'Planned by VROOM' : 'Planned by VROOM, for the previous orders',
    );
    if (orders.length === 0) text($('[data-rl-saved]'), NONE);
    else if (isFresh) text($('[data-rl-saved]'), savedText(measured, solved.measured));
    else if (broken)
      text($('[data-rl-saved]'), 'VROOM’s plan on the map is for the previous orders.');
    const room = $<HTMLElement>('[data-rl-capacity]');
    text(room, roomText(data, orders, vans, capacity));
    if (room) room.hidden = orders.length === 0;
  }

  /** What VROOM saves on these orders, and when the last van is back in each plan. */
  const result = () =>
    join(
      $('[data-rl-saved]')?.textContent?.trim() ?? '',
      backText(measure(data, dealt), solved.measured),
    );

  function fail() {
    broken = true;
    if (busy) clearTimeout(busy.limit);
    if (busy) clearTimeout(busy.slow);
    busy = null;
    worker?.terminate();
    worker = null;
    update();
    say(join(note, FAILED));
  }

  /** After a change: VROOM plans once the changes stop for a moment. */
  function later() {
    clearTimeout(settle);
    settle = window.setTimeout(solve, SETTLE_MS);
  }

  function solve() {
    if (busy || fresh()) return;
    if (broken) return say(join(note, FAILED));
    if (!worker) {
      try {
        worker = new Worker(root.dataset['rlWorker'] ?? '', { type: 'module' });
        // A worker that cannot load (a missing file, a refused script) reports here.
        worker.addEventListener('error', fail);
        worker.addEventListener('message', reply);
      } catch {
        return fail();
      }
    }
    const id = ++asked;
    busy = {
      id,
      orders: [...orders],
      vans,
      limit: window.setTimeout(fail, LIMIT_MS),
      // The first solve waits for the solver's files, and says so at once; after that a long
      // solve says so, and a quick one only says its answer.
      slow: answered ? window.setTimeout(() => say(join(note, 'Planning…')), 400) : 0,
    };
    if (!answered) say(join(note, LOADING));
    worker.postMessage({
      id,
      input: vroomInput(data, orders, vans, capacityFor(data, orders, vans)),
      options: { explorationLevel: explorationFor(orders.length), timeoutMs: 5000 },
    });
  }

  function reply({
    data: answer,
  }: MessageEvent<{ id: number; output?: VroomOutput; ms?: number; failed?: string }>) {
    if (!busy || answer.id !== busy.id) return;
    const job = busy;
    clearTimeout(job.limit);
    clearTimeout(job.slow);
    busy = null;
    answered = true;
    let plan: Plan;
    try {
      if (answer.failed || !answer.output) throw new Error(answer.failed);
      plan = fromVroom(answer.output, job.vans);
    } catch {
      return fail();
    }
    solved = solvedFor(job.orders, job.vans, plan);
    draw('after', plan, solved.measured, job.orders.length, job.vans);
    update();
    // The orders changed while VROOM planned: plan them now, as one.
    if (!fresh()) return solve();
    const used = vansUsed(plan);
    const reported = join(
      `Planned in ${solveTime(answer.ms ?? 0)}, in this browser.`,
      used < job.vans ? `VROOM needed ${used} of your ${job.vans} vans.` : '',
      plan.unassigned.length
        ? `${plan.unassigned.length} ${plan.unassigned.length === 1 ? 'order does' : 'orders do'} not fit in the vans.`
        : '',
    );
    say(join(note, reported), join(note, result(), reported));
    note = '';
  }

  /** After any change: redraw, then plan, or say there is nothing to plan. */
  function changed(what: string) {
    note = what;
    if (orders.length === 0) {
      // VROOM's plan for no orders is no route: nothing to ask the solver.
      solved = solvedFor([], vans, {
        routes: Array.from({ length: vans }, () => []),
        unassigned: [],
      });
      draw('after', solved.plan, solved.measured, 0, vans);
    }
    update();
    if (orders.length === 0) {
      clearTimeout(settle);
      say(join(note, NONE));
      note = '';
    } else if (fresh() && !busy) {
      say(note, join(note, result()));
      note = '';
    } else later();
  }

  /** Puts the controls in step with the state, after a day or a surprise sets it. */
  function show(dayId: string | null) {
    for (const r of dayRadios) r.checked = r.value === dayId;
    for (const r of vanRadios) r.checked = Number(r.value) === vans;
    for (const b of boxes) b.checked = orders.includes(Number(b.value));
  }

  const fleet = (n: number) => `${n} ${n === 1 ? 'van' : 'vans'}`;

  function surprise() {
    const pool = data.points.filter((p) => p.order !== undefined).map((p) => p.i);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [pool[k], pool[j]] = [pool[j] ?? 0, pool[k] ?? 0];
    }
    orders = pool.slice(0, 10 + Math.floor(Math.random() * 15));
    vans = 2 + Math.floor(Math.random() * 3);
    show(null);
    changed(`A surprise: ${orders.length} orders, ${fleet(vans)}.`);
  }

  function input(box: HTMLInputElement) {
    if (box.name === 'rl-day') {
      const chosen = DAYS.find((d) => d.id === box.value);
      if (!chosen || !box.checked) return;
      orders = [...chosen.orders];
      vans = chosen.vans;
      show(chosen.id);
      return changed(`${chosen.name}: ${orders.length} orders, ${fleet(vans)}.`);
    }
    if (box.name === 'rl-vans') {
      vans = Number(box.value);
      return changed(`${fleet(vans)}.`);
    }
    if (box.name !== 'rl-order') return;
    const place = Number(box.value);
    const p = data.points[place];
    orders = box.checked
      ? [...orders.filter((o) => o !== place), place]
      : orders.filter((o) => o !== place);
    const current = DAYS.find((d) => d.id === dayRadios.find((r) => r.checked)?.value);
    if (current && keyOf(current.orders, 0) !== keyOf(orders, 0))
      for (const r of dayRadios) r.checked = false;
    changed(box.checked ? `Added ${name(place)}: ${p?.order ?? ''}.` : `Removed ${name(place)}.`);
  }

  root.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement) input(event.target);
  });
  root.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-rl-surprise]')) surprise();
  });

  // The tip over the place under a mouse, on either map, from that map's own plan; and the hand
  // cursor only where a click would toggle an order.
  root.addEventListener('pointermove', (event) => {
    const map = event.target instanceof Element ? event.target.closest('svg[data-rl-map]') : null;
    for (const svg of all<SVGSVGElement>('svg[data-rl-map]')) {
      const box =
        svg === map && event.pointerType === 'mouse'
          ? nearest(root, svg, event.clientX, event.clientY)
          : null;
      svg.toggleAttribute('data-rl-near', box !== null);
      tip(svg, box ? Number(box.value) : null);
    }
  });
  root.addEventListener('pointerleave', () => {
    for (const svg of all<SVGSVGElement>('svg[data-rl-map]')) tip(svg, null);
  });

  function tip(svg: SVGSVGElement, place: number | null) {
    const group = $<SVGGElement>('[data-rl-tip]', svg);
    const label = group && $<SVGTextElement>('text', group);
    const panel = group && $<SVGRectElement>('rect', group);
    if (!group || !label || !panel) return;
    const p = place === null ? undefined : data.points[place];
    group.toggleAttribute('data-rl-show', p !== undefined);
    if (place === null || !p) return;
    const plan = svg.closest('[data-rl-plan="after"]') ? solved.plan : dealt;
    const lines = tipLines(data, plan, place);
    // The panel sits above the place (below it near the map's top), and inside the map: anchored
    // at its start or end near either side, and moved in if it still runs over.
    const [, , width, height] = data.viewBox;
    const anchor = p.x < width * 0.25 ? 'start' : p.x > width * 0.75 ? 'end' : 'middle';
    const first = p.y < height * 0.2 ? 1.9 : -1.25 * (lines.length - 1) - 1.3;
    const spans = lines.map((line, k) => {
      const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      if (k === 0) span.setAttribute('class', 'rl-tip-name');
      span.setAttribute('dy', `${k === 0 ? first : 1.25}em`);
      span.textContent = line;
      return span;
    });
    label.setAttribute('text-anchor', anchor);
    label.setAttribute('y', String(p.y));
    label.replaceChildren(...spans);
    const moveTo = (x: number) => {
      for (const span of [label, ...spans]) span.setAttribute('x', String(x));
      return label.getBBox();
    };
    let box = moveTo(p.x);
    const pad = box.height / lines.length / 3;
    const over = Math.max(0, pad - box.x) + Math.min(0, width - pad - (box.x + box.width));
    if (over !== 0) box = moveTo(p.x + over);
    panel.setAttribute('x', String(box.x - pad));
    panel.setAttribute('y', String(box.y - pad));
    panel.setAttribute('width', String(box.width + 2 * pad));
    panel.setAttribute('height', String(box.height + 2 * pad));
  }

  update();
  // What the visitor did while this module loaded, in order; the state above already holds it,
  // and replaying it says what it did.
  for (const action of queued.splice(0)) {
    if (action instanceof HTMLInputElement) input(action);
    else surprise();
  }
  if (!fresh() && orders.length > 0) later();
}
