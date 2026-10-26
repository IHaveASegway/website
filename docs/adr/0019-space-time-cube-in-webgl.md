# ADR 0019: Interactive 3D where it shows the work: the Route Lab's space-time cube in WebGL

Status: Proposed · 2026-10-26 · Deciders: Joseph Peterson

## Context

On 2026-10-26 Joseph read the live site as plain, still and narrow, and asked for pages with more interactive features and "high level 3D or reactive" parts that demonstrate his skills. The site's rules said the opposite in three places:

- **Principle 6** ([product.md](../product.md#principles)), from his own direction on 2026-10-24: "There is a difference between demonstrating and executing." No page describes the site, and no decoration delays reading.
- **The design system's rejected list** ([design-system.md](../design-system.md#rejected)): "WebGL hero: GPU and battery cost on every visit, an LCP risk, and it carries no information."
- **The budgets**: 5,000 B of eager JavaScript on every page, 2,000 B of lazy JavaScript per feature, and the Route Lab's own lazy budget of 12,000 B ([ADR 0016](0016-route-lab-in-the-browser.md)). A minimal three.js scene is 132,408 B gzip on its own (three 0.186.1, bundled with esbuild 0.28.2, measured 2026-10-26).

The two directions fit together once the line is drawn where Joseph drew it on 2026-10-24: **3D that executes, showing the visitor something about the work that they could not see without it, is the work; 3D that decorates is still rejected.** The Route Lab already shows the line: it is interactive, and it is the work.

What the Route Lab's two maps cannot show is **when**. They show where each van drives. They cannot show that, as the orders came in, three vans are still out at 2 h 30 min while VROOM's are home. The classic answer is the space-time cube: Torsten Hägerstrand's time geography (1970), revisited for cartography by Menno-Jan Kraak, "The Space-Time Cube Revisited from a Geovisualization Perspective" (2003). The map lies flat, time rises from it, a van that drives traces a slope, and a van that stands at a stop climbs straight up. Two cubes on one scale make the plan that keeps its vans out longer stand taller.

Measured on 2026-10-26, gzip -9, 1 KB = 1,000 B:

| Library | Minimal scene | Notes |
|---|---|---|
| three.js 0.186.1 | 132,408 B | the library a reader recognizes; fat lines (`Line2`), and controls if wanted |
| OGL 1.0.11 | 13,475 B | about a tenth of the size; fewer extras, and a smaller community |
| MapLibre GL 6.16.0 | 287,485 B | a real 3D map, larger than the Route Lab's WebAssembly |
| Motion 14.6.0 (`animate`, `scroll`, `inView`) | 27,277 B | not needed: CSS scroll timelines cover the reveal on Home (PR 28) |

## Decision

**The Route Lab gets a space-time cube, drawn with three.js in WebGL, loaded on intent at the cube.**

- **A view, never a second model.** The cube reads both plans from the Route Lab's app on one DOM event, `rl:plans`, which the app sends after every redraw (`components/route-lab/app.ts`), and asks for them with `rl:ask` when it arrives late. It plans nothing, keeps no copy, stores nothing and sends nothing. The maps' plan is the one source of truth; the weaker design, a cube that runs VROOM or reads the data again, could disagree with the maps on screen.
- **One domain core, as lab.md asks.** `lib/route-lab/timeline.ts` turns a plan into tracks through (x, y, t) on the same matrices `measure()` reads, so a track ends exactly when `measure()` says its van is back, and `test/space-time.test.ts` holds it to that on the real data. `lib/route-lab/space-time.ts` is the one orthographic camera both the build's picture and the browser's scene use, with no DOM and no three.js.
- **Complete without JavaScript.** The build draws each plan's cube as an SVG picture from the scene's starting camera. The floor is a plane, so its projection is affine: the picture lays the page's own basemap down with one `matrix()` through `<use href="#rl-base">`, with no second copy of it. Each picture has a name that says what it shows, and the stop tables hold every figure as text.
- **The canvas takes the picture's place at the same angle and the same aspect**, so nothing moves when it arrives (`e2e/cube.spec.ts` measures the page below it). Its floor is painted from the same `#rl-base` paths with `Path2D`, which reads SVG path data, so the page policy's `img-src 'self'` needs no `blob:`. Colors are the theme's tokens, turned into sRGB through a one-pixel canvas, since three.js does not read OKLCH; a theme change repaints.
- **Turning without scroll-jacking.** A drag sideways turns both cubes, one camera; a mouse's drag up or down tilts them; arrow keys turn a focused cube and Home sets it back. No wheel or pinch zoom, and `touch-action: pan-y`, so a finger's swipe up or down scrolls the page.
- **Nothing moves by itself.** The scene draws only on a change. "Play the day" runs the time slider to the end in 12 s, is started by the visitor, stops at the end, and the same button pauses it (SC 2.2.2). No CSS animation is added, so the reduced-motion checks are unchanged.
- **Loaded on intent at the cube, never on a scroll**: a mouse over it, a focus or a press inside it, or a touch of its slider or Play, which is kept for the scene. That is ADR 0016's rule for the app, applied to the cube. Without WebGL, or when the context is lost, the pictures stay and the cube's controls hide.

The rules change, each with its test:

| Rule | Before | After | Test |
|---|---|---|---|
| Principle 6 and the rejected list | no WebGL; a WebGL hero rejected | interactive 3D is allowed where it shows the work, on intent, over a picture that stands without it; a decorative WebGL hero stays rejected | review; this record |
| The Route Lab's budgets | lazy JavaScript ≤ 12,000 B, everything the page reaches | the same 12,000 B for the app and the solver alone (10,832 B), and the cube's own: its chunk and what only it reaches ≤ 150,000 B (141,339 B), and its first view with the app, the route data and the cube ≤ 400,000 B (352,329 B). The first view stays ≤ 150,000 B (147,166 B) and the first solve ≤ 600,000 B (559,013 B) | `test/budgets.test.ts` |
| Dependencies | no runtime library in the browser | `three` 0.186.1, MIT, pinned exactly, bundled into the cube's chunk only | `test/budgets.test.ts` (the chunk is the cube's alone) |

The weaker budget design was to raise the Route Lab's 12,000 B to about 155,000 B. It would let the solver's own code grow twelvefold before any check noticed. A budget per part keeps each number's meaning.

**Home (decided, in the next pull request).** Joseph chose an interactive 3D element on Home as well. It reuses this cube rather than adding a decorative scene: Home shows the cube as a picture drawn at build, which costs no JavaScript and keeps the first view inside its 150,000 B, and the same scene replaces it on intent. The three.js chunk and the data it needs load only after a visitor shows intent, so they count in a budget of their own, not in Home's first view. That pull request amends this record with its measured figures.

## Alternatives considered

| Option | Bytes | What it shows | Door |
|---|---|---|---|
| **A. A space-time cube in three.js, on intent, over a build-time picture (chosen)** | 141 KB lazy | when each van is where, which the maps cannot | Two-way |
| B. The same cube in OGL | about 22 KB lazy | the same | Two-way; less code of others, more of ours, and a library fewer readers know |
| C. The same cube in hand-written WebGL2 | under 10 KB | the same | Two-way; bespoke shaders and line drawing to maintain, which the prior art already solves |
| D. The cube as SVG only, its camera turned by script | about 3 KB | the same, without real depth or a time plane | Two-way; the cheapest, and a fair fallback, but not the 3D Joseph asked for |
| E. A decorative WebGL hero on every page | 100 KB or more on every visit | nothing about the work | Two-way, and rejected on 2026-10-24 for that reason |
| F. Extruded isochrones in a 3D map (MapLibre, deck.gl) | 287 KB and up | the drive-time bands as height | Two-way; the bands already read in 2D |

## Consequences

- **A runtime dependency.** three.js ships a release a month; Dependabot sees it. Its chunk is the largest file the site serves after the solver's WebAssembly.
- **The Route Lab's first view has 2,834 B of headroom** under 150,000 B, after 2,706 B of HTML for the two pictures, 254 B of eager JavaScript and about 420 B of CSS. The next addition to that page will need to take something out or amend that budget here.
- **A GPU cost only for a visitor who asks for it.** Nothing draws without a change, so an idle cube costs nothing.
- **Headless Chromium draws WebGL through SwiftShader**, so CI tests the real scene: screenshots of the canvas change with a drag, a key and the slider, and come back with Reset and Home.

## Door

Two-way. The cube is one component, one chunk and one dependency; removing them leaves the pictures, which stand alone. The principle's amendment is a policy, and reverting it is an edit to this record and product.md.

## Revisit if

- The cube's chunk passes 150,000 B gzip, or three.js drops WebGL for WebGPU only.
- On Joseph's phone, the cube takes more than 1 s from a touch to its first frame, or turning it drops below 30 frames a second.
- Field data shows INP over 200 ms on `/lab/routes/`.
- People Joseph watches use the page load the cube but rarely turn it or play the day. Then it is decoration after all, and D, the picture alone, is enough. The site records no interactions, so this is evidence from watching, not from analytics.
