// A lab's event log in the browser, the one way all of them write it. New lines go on the end, and
// the oldest drop past LINES_SHOWN. The box itself (lab-page.css, .lab-log) stands on its end with no
// script, flex-direction: column-reverse, so a reader at the end stays there as lines come, and the
// log opens on its newest line from the first paint. Until 2026-11-02 each app worked that out on
// every frame, and a log opened on its oldest lines, then jumped at the first hover or press.
//
// A reader who has scrolled back stands some way up from the end, which is what the box's scrollTop
// says under column-reverse: 0 at the end and negative above it. New lines would slide what they are
// reading up and away, by the lines' height, and iOS Safari has no scroll anchoring to stop that, so
// the writer moves the box by as much. Lines dropped from the top change nothing below them.

/** The most lines the log keeps: the build writes as many, so the two show the same lines. */
export const LINES_SHOWN = 60;

interface Line {
  readonly at: number;
  readonly text: string;
}

export interface EventLog<L extends Line> {
  /** Shows the run's lines, adding what's new. A run that doesn't hold the last line shown is
   *  another run: the log starts again, on its end. */
  draw(lines: readonly L[]): void;
  /** Empties it, for a run whose lines come next. */
  clear(): void;
}

export function eventLog<L extends Line>(
  list: HTMLElement | null,
  atClass: string,
  time: (at: number) => string,
  /** The last line the build wrote, when the page's log is already this run's. */
  written?: L,
): EventLog<L> {
  let shown = written;
  const box = list?.parentElement;
  const clear = () => {
    list?.replaceChildren();
    shown = undefined;
    if (box) box.scrollTop = 0;
  };
  return {
    clear,
    draw(lines) {
      if (!list || !box) return;
      const last = lines.at(-1);
      if (last === shown) return;
      const from = shown ? lines.indexOf(shown) + 1 : 0;
      if (shown && from === 0) clear();
      const back = box.scrollTop;
      const height = box.scrollHeight;
      for (const line of lines.slice(from === 0 ? Math.max(0, lines.length - LINES_SHOWN) : from)) {
        const item = document.createElement('li');
        const at = document.createElement('span');
        at.className = atClass;
        at.textContent = time(line.at);
        item.append(at, ` ${line.text}`);
        list.append(item);
      }
      if (back < -1) box.scrollTop = back - (box.scrollHeight - height);
      while (list.children.length > LINES_SHOWN) list.firstElementChild?.remove();
      shown = last;
    },
  };
}
