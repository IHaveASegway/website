# ADR 0021: A rail for the navigation, and a living ground on Home

Status: Proposed · 2026-10-29 · Deciders: Joseph Peterson

## Context

On 2026-10-28 Joseph read Home as too bland and asked for two things: "a side bar instead of the top nav bar", and "animated or changing graphics: i like the terain thing but it should move and slightly change when hovered, and it should rotait to some kind of 3d sercetry or hardware stuff and then something pratical and organic as well". He asked for something well thought out, to iterate on once it is in production.

The site's rules said no to the second in two places:

- **Principle 6** ([product.md](../product.md#principles)), as amended by [ADR 0019](0019-space-time-cube-in-webgl.md): interactive 3D is allowed where it shows the work, on intent, over a picture that stands without it; "3D that only decorates is still out".
- **The rejected list** ([design-system.md](../design-system.md#rejected)): "A decorative WebGL hero: GPU and battery cost on every visit, an LCP risk, and it carries no information."

Each of those costs can be bounded rather than accepted, and the "terrain thing" Joseph likes is already on Home: the travel-time contours the build draws behind the hero (page geometry, 2026-10-27). So the question is not whether Home gets a WebGL hero, but whether that drawing may move, at what price, and under which guards.

The rail is a layout question with one trap. Every rule from 64rem up was set for at least 56rem of content: the cards' 12 columns, the page heads, the Route Lab's maps and labels. A rail beside the content takes its width out of that.

## Decision

### The rail

**From 80rem the header is a rail down the left edge, 14rem wide, as tall as the window and still while the page scrolls. Below 80rem it is the row across the top it always was.**

- One header, two layouts, in CSS: the same `<header>` with the same links in the same order, so the nav manifest, the skip link and the landmarks do not change. The skip link stays the first thing Tab reaches and covers the whole rail when focused.
- The rail holds the name, linking home, and the title under it (left out on Home, whose `<h1>` is the name, though the nav starts at the same height on every page); then the nav, the page marked by the 2 px apricot bar the cards sweep, standing at the link's edge; and at its foot the command menu's button, Home's motion button and the theme toggle. The command menu's button moved from the footer into the header so there is one of it, wherever the header is.
- **Why 80rem and not 64rem.** At 64rem a 14rem rail leaves 42rem of content where those rules expect 56rem. From 80rem it leaves at least 58rem. Each rule set for more than that moves out by the rail's width: the hero's facts beside the name from 75rem to 89rem, the Route Lab's 80rem and 90rem steps to 94rem and 104rem, so each still sees the width of content it was set for.
- The content keeps the standard frame, 90rem with its margins, in the column beside the rail, so it never grows past the measure Joseph chose on 2026-10-26. At 1440 px the content is 1,072 px wide, against 1,312 px without the rail.
- Below 80rem a top bar, not a drawer: three links and three small buttons fit on one line at 768 px, and a drawer would hide the navigation behind a press for no gain.

Prior art: Brittany Chiang's portfolio (a sticky left column on wide screens, the top otherwise), GitHub Primer's split page layout (a pane beside the content from a breakpoint, stacked below it), and the WAI landmark guidance, which keeps one `banner` whatever it looks like.

### The living ground

**Home's contour drawing comes alive on the GPU: one WebGL2 fragment shader, no library, over the drawing the build made, which stays as the first paint and the fallback.**

- **What it draws.** The contour lines of a field on a plane seen in perspective. The field holds a picture for 9 s, then turns into the next over 3 s, a 36 s cycle: **terrain** (fractal value noise, drifting), a **circuit board** (a Voronoi diagram under the chessboard distance, whose borders run at 0, 45 and 90 degrees like traces and whose points round off like vias, with rings leaving each via like a signal), and **cells** (a Voronoi diagram under the usual distance, warped by noise, its walls drawn and rings growing round each cell like wood). The camera turns with the field: a relief map's tilt for the terrain, the board seen corner-on, the cells from above. Every third contour is heavier, as on a survey map and in the drawing it replaces. Inigo Quilez's articles on fBm, Voronoi and smooth isolines are the reference for the math.
- **The pointer.** A mouse or a pen raises a soft hill under itself, so the lines bend around it, and leans the camera up to about 3 degrees toward it, both eased. A touch does nothing.
- **Contrast holds by construction.** Every line is `--ground`, over the page's own background, so no text over a line loses contrast, as with the drawing (its one accent mark is not drawn). The color is read from the drawing's own lines through a one-pixel canvas, since WebGL does not read OKLCH, and again on every theme change.
- **When it runs.** Home's motion module loads the chunk after the page has loaded, when the main thread is idle, and only on Home, with no reduced-motion preference and no Save-Data. Without WebGL2, with a shader that does not compile, or when the context is lost, the drawing stays. It draws only while the canvas is on screen and the tab is visible. The canvas is absolutely placed in the drawing's box, under the same masks, so it shifts nothing and is never the LCP element.
- **What it may cost, enforced where it runs.** 30 frames a second, since the field drifts slowly and 60 would double the GPU's work for nothing; a pixel ratio of at most 1.5, which keeps 1 px lines crisp with 44% fewer pixels than 2; four octaves of noise, not five. A governor watches the mean frame over each 60 frames: under 20 frames a second it drops to a ratio of 1, and if that is still too slow it hands back to the build's drawing for good. That is load shedding on the visitor's own machine: a laptop that cannot afford the picture gets the still one, rather than a hot GPU.
- **A pause control (SC 2.2.2).** It moves for more than 5 s, so the header carries a pause and play button on Home, unseen until the ground runs but holding its place, so the header never moves. The choice lasts for the tab, in `sessionStorage` under `motion`, as the theme's does: the site still stores nothing past a tab (security.md, "Privacy and data inventory"). Paused, the clock stands still and the GPU does nothing; only the visitor's own pointer still raises its hill, which is not motion that starts by itself, and once it settles nothing draws.

The rules change, each with its test:

| Rule | Before | After | Test |
|---|---|---|---|
| Principle 6 and the rejected list | 3D only where it shows the work, on intent; a decorative WebGL hero rejected | the same, and one exception: Home's own drawing may move on the GPU, when it costs at most 6,000 B of lazy JavaScript, loads after the first paint, keeps the build's drawing as its fallback, follows reduced motion and Save-Data, pauses on request and off screen, and keeps every line on `--ground` | `test/budgets.test.ts`; `e2e/living-ground.spec.ts`; review |
| Budgets | Home's eager JavaScript, CSS and first view | the same, and the ground's chunk as a feature of its own: at most 6,000 B, Home's first view with it at most 150,000 B | `test/budgets.test.ts` |
| Motion | "Nothing moves for more than 5 s without a pause control" | unchanged; the ground is the first motion to need the control | `e2e/living-ground.spec.ts` |
| Storage | `theme` is the only key | `theme` and `motion`, both for the tab only | `e2e/living-ground.spec.ts`; security.md |

## Alternatives considered

| Option | Bytes | Trades | Door |
|---|---|---|---|
| **A. Raw WebGL2, one fragment shader, over the build's drawing (chosen)** | 3,306 B gzip, lazy | true perspective and smooth morphs between fields for almost no bytes; the GPU works while it runs, and the shader is ours to maintain | Two-way |
| B. SVG path morphing (flubber-style) and CSS 3D transforms | about 9 KB lazy | no GPU; but a hover that bends lines rewrites path data every frame on the main thread, morphs between path sets of different sizes look poor, and CSS 3D tilts a flat picture rather than seeing a plane | Two-way |
| C. three.js, reusing the Route Lab's cube | about 140 KB lazy | the richest scene and a known library; about 140 KB on Home for decoration, against ADR 0019's "on intent" and Home's 150 KB | Two-way |
| D. OGL, the small WebGL library | about 13 KB lazy | the fallback if raw WebGL gets hard to maintain; for one full-screen triangle it adds nothing the shader needs | Two-way |

Prior art: Stripe's home page gradient, a bespoke WebGL runner of about 10 KB rather than a 3D library, is the best-known case of a hero drawn with one small shader.

## Consequences

- **A GPU cost on Home, bounded.** It draws only on screen, in a visible tab, without a reduced-motion preference, at 30 frames a second, and stops on pause. Measured on 2026-10-29 at 1800 × 1350 (the 1200 × 900 canvas at the 1.5 cap), timing each draw to a read-back, after warm-up: 0.37 ms a frame for terrain, 0.41 for the board, 0.57 for the cells and 0.73 while two blend, on an Apple M4 Max through ANGLE's Metal backend; 17 to 33 ms on SwiftShader, Chromium's software renderer, which the governor sheds. The M4 Max is not mid-range: a typical integrated GPU is several times slower, so a frame there is estimated at 3 to 7 ms, about a fifth of the GPU at 30 frames a second. That is an estimate; the governor, not the estimate, is what holds it.
- **Bytes.** The chunk is 3,306 B gzip -9. Home's eager JavaScript rises from 2,965 B to 4,024 B of its 5,000: the motion module now imports Vite's 852 B preload helper statically, the chunk the two labs' boots already share and a visitor's browser caches. Home's first view rises from 81,686 B to 83,211 B, and to 86,517 B with the chunk, of 150,000.
- **The command menu's button moved into the header**, from the footer, so the rail holds it; there is still one.
- **Two fixes the narrower column surfaced.** The Route Lab's cube canvas took its height from its whole pixels while the picture it replaces takes its height from its viewBox, and at the new width the two differed by a pixel, which moved the page below (`e2e/cube.spec.ts` caught it); the canvas now carries the picture's exact ratio. And `e2e/ground.spec.ts` counted the command menu's visually hidden name, now near the 404's accent mark at 390 px, as text the mark touched; clipped text draws nothing, and the check now skips it, as `e2e/a11y.spec.ts` already did.
- **Less room for content at wide sizes.** At 1440 px the content is 1,072 px instead of 1,312 px; the hero's facts stand beside the name from 89rem instead of 75rem; the Route Lab's two maps keep their 64rem label sizes up to 94rem.
- **One more stored key**, `motion`, for the tab, which the data inventory lists.

## Door

Two-way. The rail is CSS over the same header; removing the 80rem block gives back the top row. The living ground is one chunk and one canvas; removing them leaves the build's drawing, which stands alone. The amendment to principle 6 is a policy, and reverting it is an edit to this record and product.md.

## Revisit if

- Home's Lighthouse performance score, LCP or CLS regresses against the build before this record, or field INP on Home passes 200 ms.
- The shader costs more than about 4 ms a frame on a mid-range laptop's GPU, or a visitor reports a hot laptop or a drained battery on Home.
- Joseph finds the motion distracting once it is in production: then the pictures change only on hover, or it stops after one cycle.
- The rail reads as cramped on the Route Lab's maps: then the rail narrows, or collapses to icons there.
