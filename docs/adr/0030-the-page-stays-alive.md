# ADR 0030: The page stays alive behind you, and a lab is running when you land

Status: Proposed · 2026-11-02

## Context

Reading the site on his phone, Joseph wrote: "As i scroll down many of the pages, it just turns white with text or back with text, the animations stop and there is no like background, looks unfinished." Then, of the labs: each one's "animated sketch at the very top should probably be running when you first land on the page."

He was right on both, and for one reason. The first screen was the only part of the site that had been designed as a place. ADR 0024 and ADR 0028 put a live picture on Home's opening, and below it the page was a white or black sheet. A lab stood still until a press, because ADR 0020 loads its simulation on intent to keep the first view light. A visitor can't tell a demo that's waiting from a demo that's broken.

## Decision

**The field.** Every page stands on one layer, fixed to the window behind everything:

| Part | What it is | How it moves |
|---|---|---|
| The grid | Faint lines, 4 to 6 rem apart | It doesn't. The page scrolls over it, which is the depth. |
| The patch | The grid lit in the accent, in one soft hole | A veil with a hole in it wanders across the window on a 73 s clock |
| The current | Lines of light that run on the grid's lines | Each on its own clock, of 13 to 37 s, a prime number of seconds so they never fall into step |
| The charge | A 2 px line at the window's top | Fills with the scroll, since how far down you are is what it says |

The veil is the design's one trick. Moving a mask would repaint the window on every frame. Moving a large layer with a hole in it costs a transform on the compositor.

**It runs by itself, not with the scroll.** The first version tied the patch and the current to the scroll, and showed the current only while the page moved, so no line would stand across the words someone was reading. On the preview Joseph wrote: "Every scroll in chrome like retriggers the lines to move, instead of allowing them to move freely in the background. Makes it feel like it is reloading every time i scroll." A scroll wheel moves in ticks, so each tick flashed the lines on and jerked them along. Scroll-linked motion suits what measures the scroll, as the charge does, and a background isn't measuring anything. So a scroll now changes nothing in the field, and `e2e/landing.spec.ts` holds that. The lines run dim, and quieter still behind a long read, by its colours, since an opacity over the whole layer would be composited again on every frame.

**Lines carry current, once.** A section opens on a line that sweeps across when a visitor first reaches it, and stays lit. The line down What I build lights row by row as each reaches its height in the window, with the row's mark. Scrolling back doesn't run any of it again. The sweep is a single move of under 5 s, so it needs no pause (SC 2.2.2). Facts' lines carry a signal, and lab glyphs' wires a spark, by the clock. Text never moves, per ADR 0025. This reverses ADR 0025's "no rule draws itself" for these lines alone.

**One choice, one button.** Since the field runs on every page, every page's top bar holds the pause button (SC 2.2.2). `scripts/field.js` is the one owner of the choice: it marks the page (`data-motion`) unless the visitor asked for less motion or to save data, and CSS, a lab's run and the Route Lab's vans all read the mark. The press lasts for the tab.

**A lab is running when you land.** Once the page is marked, its simulation loads and plays, which reverses ADR 0020's load on intent for arrival only. It plays only while the demo is on the screen and the tab is showing. Its live regions say nothing until the visitor's first press, and from that press the demo is theirs. Its own Pause stops that demo and nothing else, so the next lab still lands running. A link to a run still opens paused.

**The Route Lab's vans.** It has no simulation to run, and its solver is 350 KB, so its sketch is its plans: a dot for each van drives the route already drawn, on one clock across both maps, so the better plan is visibly home first. SMIL's `animateMotion` follows the drawn path by reference, so it needs no script to run and no copy of the route, and it sits on a layer of its own so a moving dot repaints nothing of the map.

## Options

**The background**

| Option | Cost to a phone | Bytes | Gives |
|---|---|---|---|
| CSS field on its own clocks, compositor transforms (chosen) | One transform per moving layer, always | About 3 KB of CSS | Every page, both themes, and a scroll touches none of it |
| The same field tied to the scroll (the first version) | Idle when the page is | The same | Motion only under a thumb, and every wheel tick read as the page reloading |
| WebGL ground, as ADR 0021 tried | A GPU program running all the time | 140 KB of three.js, or a hand-written shader | Richer light, retired by ADR 0024 for what it cost |
| A canvas on the main thread | A frame's script per frame, fighting the scroll | Small | Nothing the CSS doesn't, and it lags under a thumb |
| Art per section, as Linear and Stripe do | Depends on the art | Large, and more with every section | The strongest result, and a design project per page |

**The labs**

| Option | Weight on arrival | Truth |
|---|---|---|
| Run the real simulation (chosen) | 8 to 13 KB, after the page has settled | It's the thing itself, so it can't disagree with the page |
| A CSS loop of the picture, as Home's Orbit does | None | Looks right, and would be a drawing of a demo sitting on top of the demo |
| Keep load on intent, with a louder Run button | None | Doesn't answer him: a page that needs a press still reads as stopped |

Below all of it, the default styles are the finished state, so with no script or under reduced motion a page shows the grid and every line lit, with nothing to fix.

## What holds it

- `test/tokens.test.ts`: at the field's brightest point every text token still reaches 4.5:1, since axe can't read a gradient.
- `e2e/motion.spec.ts`: under reduced motion nothing moves, and with no preference exactly this list does.
- `e2e/steady.spec.ts`: on an iPhone in WebKit, a lab starting by itself moves nothing under a still thumb.
- `e2e/landing.spec.ts`: each lab runs with no press, and holds back for reduced motion, Save-Data and the top bar's Pause. A turn of the wheel changes nothing in the field and doesn't restart a line.

## Door

Two-way. It's about 300 lines of CSS, one component's markup and a return value on each lab's `start`. Removing the `<div class="field">` and the landing call puts the site back.

## Revisit if

- Joseph's phone shows the page stuttering or running warm. A transform by the clock runs on the compositor on every iPhone, and the charge's scroll timeline does from iOS 26.4, but nothing here can measure a real phone. The first thing to cut is the veil's travel, the largest layer, then the number of lines.
- A reader says the grid gets in the way of reading: raise the calm on long reads, or drop the lit lines behind them.
- A lab's run costs a visitor something measurable: lab pages' Lighthouse performance falls under its gate.

## Further reading

- Bramus Van Damme, [Scroll-driven Animations](https://scroll-driven-animations.style/), on what ties well to a scroll, and what doesn't.
- WebKit, [bug 312407](https://bugs.webkit.org/show_bug.cgi?id=312407), on when Safari's scroll-driven animations came off the main thread (iOS 26.4).
- Paul Lewis and Paul Irish, [High Performance Animations](https://web.dev/articles/animations-guide), on why transform and opacity are the cheap ones.
- W3C, [Understanding SC 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html), on what starts by itself.
