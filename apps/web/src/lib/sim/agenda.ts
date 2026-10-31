// What happens next in a simulated run: every pending event, ordered by its virtual time and then
// by the order it was scheduled, so two events at the same millisecond always run the same way.
// A binary heap keeps the next one at the top; the Raft Lab's few timers scan a list instead, but
// a cache with hundreds of requests in flight needs the heap.

export interface Entry<T> {
  readonly at: number;
  readonly seq: number;
  readonly event: T;
}

export interface Agenda<T> {
  readonly heap: Entry<T>[];
  seq: number;
}

export function createAgenda<T>(): Agenda<T> {
  return { heap: [], seq: 0 };
}

const before = <T>(a: Entry<T>, b: Entry<T>) => a.at < b.at || (a.at === b.at && a.seq < b.seq);

export function schedule<T>(agenda: Agenda<T>, at: number, event: T): void {
  const heap = agenda.heap;
  const entry = { at, seq: agenda.seq++, event };
  heap.push(entry);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!before(entry, heap[parent] as Entry<T>)) break;
    heap[i] = heap[parent] as Entry<T>;
    i = parent;
  }
  heap[i] = entry;
}

/** The time of the next event, or Infinity when nothing is pending. */
export function peekTime<T>(agenda: Agenda<T>): number {
  return agenda.heap[0]?.at ?? Infinity;
}

export function next<T>(agenda: Agenda<T>): Entry<T> | undefined {
  const heap = agenda.heap;
  const top = heap[0];
  const last = heap.pop();
  if (!top || !last || heap.length === 0) return top;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child =
      right < heap.length && before(heap[right] as Entry<T>, heap[left] as Entry<T>) ? right : left;
    if (!before(heap[child] as Entry<T>, last)) break;
    heap[i] = heap[child] as Entry<T>;
    i = child;
  }
  heap[i] = last;
  return top;
}
