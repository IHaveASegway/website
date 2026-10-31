# ADR 0024: Home led by the work: the Route Lab's day live behind the name, the Raft Lab's election, a bolder type

Status: Proposed · 2026-10-29 · Deciders: Joseph Peterson · Amended by [ADR 0025](0025-signal-box-identity.md): Home's new order, the city on the water, the board in the Raft Lab's chapter's place and the election retired (postscript 2026-10-30)

## Context

On 2026-10-29, after [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md) shipped, Joseph read Home again:

- "Want a animation for the routing lab as well." The Raft Lab had a moving picture in the first screen; the Route Lab's card had a small van that moved only under the pointer.
- "The ui still just isnt getting there for me. Its still so conservative and has nothing that stands out. It is playing it safe and making odd choices as if its taking me to literally."

He was right on both. ADR 0023 answered each phrase of his request with the smallest thing that satisfied it: a sentence from the bio beside a 400 px drawing, a stack of slabs standing in for "3D", a contour drawing behind everything that was deliberately faint. Read at 1440 × 900, nothing on Home was larger or brighter than the name, and the work, the reason the site exists, was two thumbnails below the fold. The reference sites lead with one confident picture of the work; Home led with restraint.

## Decision

### The first two screens are one stage, led by the Route Lab's day

- **The hero stands over a live scene of the Route Lab's default day**: Seattle's water and roads, and the three vans VROOM plans for the bakery's busy Saturday, each driving its route with a glowing trail, each stop lighting as its order is handed over, while the camera sways slowly about the city. A readout counts the day: "+1 h 12 min · 14 of 20 delivered".
- **Scrolling lifts the day into the space-time cube** ([ADR 0019](0019-space-time-cube-in-webgl.md)): as the Route Lab's chapter comes up the window, time stands up, so a van that drives traces a slope and a van at a stop climbs straight up, and the camera comes down and round. The chapter beside it carries the lab's two figures large: 5 h 34 min of driving as the orders came in, struck through, and 3 h 12 min planned by VROOM.
- **The scene stands still at the window's top** (`position: sticky`) while the hero and the chapter scroll over it. The card after the chapter slides over it on the page's own background and covers it, and the canvas stops drawing then.
- **The name is larger**: 64 px on a phone to 160 px at 1440 px (`--text-hero`), the most the zoom rule allows (2.5 times its floor).

### The Raft Lab's cluster acts out an election

Its chapter holds the cluster large, and on one 15 s loop it plays a Raft election as the paper describes it (§5.2): server 1 leads term 3 and sends heartbeats; it crashes; server 3, whose timer stands fullest, times out, stands for term 4 and asks for votes; three votes and its own, a majority of five, make it leader; it sends heartbeats of its own, and server 1 comes back as a follower and hears them. Labels over the roofs say what each server is: LEADER, DOWN, CANDIDATE. `lib/iso.ts` holds the story (`STORY`), and `test/iso.test.ts` holds it to Raft's rules and to the stylesheet that times it.

### Everything else is set larger

- **How I work**: each principle a row under a hairline, its number in the accent, its sentence at the statement size, the rest of its paragraph beside it. The stack of slabs is gone.
- **The closing**: the address set as large as the figures, the last thing on the page.
- **Selected work is still one section and one list.** Home lays it out with the demos it features first (`FEATURED_DEMOS`, `lib/work.ts`); the résumé on `/about/` reads the same list in its own order, and the tests compare the two as the same cards.

### Home's own styles are Home's alone

The stage, the scene, the chapters and the election live in `src/styles/home.css`, which only Home links. Every other page's stylesheet fell from 10,362 to 8,869 B.

### A larger screen

Added 2026-10-29, after Joseph read Home on a large screen: "it looks like a blank space mistake". The stage was composed for a 1440 × 900 window. Past it, the frame (90rem), the name (10rem) and the scene's box (three fifths of the frame) stopped growing while the window did. At 3200 × 1600 the scene's box was 864 px wide and ended 768 px short of the window's right edge, the name's top stood 60% of the way down the screen, and most of the screen was empty.

- **The room goes to the scene, which is a picture.** From 90rem, main spans the column beside the rail and every row keeps the frame's edges (`--frame-side`); the stage's scene, and the cards that cover it, reach the column's edges. The scene's box runs from beside the words to the window's right edge, 86% of its height, and the map grows to fill it: 1,536 × 1,376 px at 3200 × 1600, and 1,216 × 1,238 at 2560 × 1440, against 730 × 774 at 1440 × 900.
- **It moves clear of the words before it widens.** Room past the box's 1440 width first moves it right until it starts 2rem past the Route Lab chapter's 36rem of words, so the lifted cube, which fills its box, never runs behind a line of them; only then does it widen.
- **The type keeps its size.** Text that grows with the window does not grow with zoom ([WCAG failure F94](https://www.w3.org/WAI/WCAG22/Techniques/failures/F94)), and the name is already as large as the zoom rule allows (`test/tokens.test.ts`, "fluid type"). The first try scaled the whole stage with the window, in a rem of its own that grew with the screen. It filled the screen exactly as at 1440 × 900, but at 2560 × 1440 its 253 px name would have needed to reach 506 device pixels at some zoom up to 500%, and it reaches 375. So only the picture scales.
- **A taller window divides its extra height evenly above and below the words**, so they stand level with the map rather than sinking to the window's foot: the name's top is 38% of the way down at 3200 × 1600, against 29% at 1440 × 900.
- **The column's width comes from a container query**: main is the query container (`container-type: inline-size`), and `100cqw` is the column exactly. `100vw` counts a classic scrollbar, as on Windows or on a Mac with a mouse, and the stage would have scrolled the page sideways by its width.
- **At 1440 × 900 and below nothing moved**: every box on the stage measured the same as production's at 1440 × 900, 1440 × 800, 1280 × 800, 1024 × 768 and 390 × 844.

Two other ways were weighed. Centring a scaled stage in the column would have filled it evenly, but its words would have left the frame's edge that every row below them keeps, and its type would still have failed the zoom rule. Leaving the stage in the frame and lifting the frame's cap on Home would have lengthened every row of text below it, which Joseph read as too wide on 2026-10-26 ([design-system.md](../design-system.md), "A 12-column frame").

## The architect's pass

### Why

The need behind "nothing stands out" is a first impression that shows the work rather than describes it. A recruiter gives a personal site seconds; what they should see in those seconds is that Joseph builds real systems. The Route Lab's day is the most visual true thing on the site: real roads, a real solver's plan, real figures. The ask and the need agree here, so the design takes the ask at its word: animation, 3D, boldness, with the work as the subject.

### Data ownership

| Data | System of record | How Home reads it |
|---|---|---|
| The day: places, orders, travel times, road legs | `tools/route-data/out/route-data.json`, the Route Lab's pipeline (OpenStreetMap, ODbL) | at build, through `lib/route-lab/picture.ts`, the same module the lab's page uses |
| VROOM's plan for the day | the build's own solve, `routeLabPicture()`, once per build | the same promise the lab's page awaits: no second solve, no copy |
| The map's water and roads | `tools/route-data/out/basemap.json` | written once into Home's HTML, in the build's picture; the canvas reads the paths from that picture, so the page holds one copy |
| The vans' tracks in time | derived by `lib/route-lab/timeline.ts` from the plan | written at build to `/lab/routes/scene.json`, beside the demo that owns it, simplified (`simplify3`) |
| The figures on the chapter | `measure()` on both plans | rendered at build; none is typed |

Everything Home shows is a view derived at build from the Route Lab's records, in the same commit, so the consistency readers need, the scene agreeing with the lab, holds by construction. The map is OpenStreetMap's, so Home carries its credit wherever it shows it, as the lab does.

### Prior art

- **Animated vehicle trails over a map** are deck.gl's `TripsLayer` (vis.gl; deck.gl began at Uber): paths with a time per point, drawn up to a current time with a trail that fades over `trailLength`. The scene borrows the model, not the library: deck.gl and its WebGL stack would take most of the 150 KB a page may weigh here, for lines and dots.
- **A small renderer of one's own for a hero** is how Stripe's homepage gradient runs: public teardowns of the page find a small WebGL wrapper rather than three.js, for the same reason.
- **A 3D hero that minds its cost**: GitHub's homepage globe ("How we built the GitHub globe", GitHub blog, 2020) runs on three.js, and much of its write-up is about performance: what the globe costs a visitor's machine and how it scales down. The governor here (`nextRatio`) is the same idea in a few lines: drop the pixel ratio, then pause.
- **The sticky graphic**: data journalism's scrollytelling (The Pudding's and the New York Times' pieces, the open-source Scrollama), where a picture stands still while the story scrolls past and changes with it.
- **The space-time cube**: Hägerstrand's time geography (1970), already the Route Lab's ([ADR 0019](0019-space-time-cube-in-webgl.md)).

### Options

| | A. Canvas 2D through the cube's own camera (chosen) | B. three.js on Home, reusing the cube's chunk | C. Draw the routes in ADR 0021's WebGL2 shader | D. SVG and CSS alone |
|---|---|---|---|---|
| Bytes | 5,153 B of script, 1,995 B of data, lazy | the cube's chunk, 140,876 B, lazy | a few KB, but lines need geometry WebGL does not draw | none |
| Can the camera sway and lift into the cube? | yes, every frame | yes | yes | no: each angle is a different projection |
| Cost per frame | lines and dots on the CPU, shed by the governor when slow | GPU | GPU, always | repaints of a large SVG for every moving dash |
| Fits 150 KB for Home | yes, about 113 KB | no: about 247 KB, so Home's budget would rise near 250 KB | yes | yes |
| New code to own | one renderer, about 400 lines, on tested pure geometry | a scene graph for lines and dots | a line renderer in a shader | keyframes per van |

A wins on weight and on owning the least new code: the projection, the fit and the tracks are pure functions shared with the cube and tested, and the renderer only strokes what they return. B buys lighting and shading the scene does not need, at twice Home's whole page weight. D cannot move the camera. **Door: two-way**: one component, one chunk, one data file and one stylesheet; reverting is one commit, and ADR 0021's living ground is in history.

### Combine before creating

| Piece | Responsible for |
|---|---|
| `lib/route-lab/picture.ts` (existing) | the day and VROOM's plan, once per build |
| `lib/route-lab/timeline.ts` (existing) | each van's day as x, y, t |
| `lib/route-lab/space-time.ts` (existing) | the cube's camera axes |
| `lib/route-lab/scene.ts` (new, pure) | the scene's camera between flat and lifted, the fit, the floor's matrix, simplifying a track, the data file's format |
| `components/RouteScene.astro` (new) | the picture without JavaScript, and the one copy of the map |
| `scripts/route-scene.ts` (new) | drawing a frame, the clock, the scroll, the pause button, the governor |
| `scripts/motion.js` (existing) | loading it after the first paint, never under reduced motion or Save-Data |

## Consequences

- **The living ground is gone** ([ADR 0021](0021-rail-and-living-ground.md), amended): Home's contour drawing and its shader (`ground-live.js`) are removed. Home's scene now owns the header's pause button, which pauses the scene and the Raft election together (SC 2.2.2), for the tab.
- **Design principle 6 is amended** (product.md): a scene that shows the work may run on Home after the first paint, over a picture that stands without it, paused on request. 3D that only decorates is still out.
- **Bytes, gzip -9, measured 2026-10-29.**
  - Home's HTML: 10,046 → 25,284 B. Most of it is the map, inline once.
  - Home's stylesheets: 10,362 → 12,534 B (global 8,869 and home 3,262, plus the tokens). Every other page: 10,362 → 8,869 B.
  - Lazy, Home only: the scene 5,153 B with the camera and format chunks it shares with the Route Lab, and its data 1,995 B; the living ground's 3,306 B are gone.
  - Home's first view with the scene: about 113 KB of the 150 KB every page keeps (`test/budgets.test.ts`).
- **On a phone the first screen holds the scene, the name and the title**; the hero's sentence and buttons follow just below (`e2e/fold.spec.ts`). From 64rem the whole hero is in the first screen.
- **The data file writes every list of numbers as one string**, with spaces, not commas: a list with commas reads as figures with thousands separators, and the content scan reads figures. It found one on the first build.
- **Tests.**
  - `test/scene.test.ts`: the camera the picture and the canvas share, with known answers; the tracks against the timeline and `measure()`; the data file's format, round trip.
  - `test/iso.test.ts`: every message ends at its receiver; the story is a Raft election; every act has its keyframes on one loop.
  - `e2e/rail-and-scene.spec.ts`: the scene takes over from the picture, moves, pauses and plays for the tab, lifts with the scroll and sets down again, shifts nothing, stays a picture under reduced motion and without its data, and the election pauses with it. On a larger screen, at 1920 × 1080, 2560 × 1440 and 3440 × 1440, the scene's box reaches the window's edge past the chapter's words, the words keep the frame's edge and the name's size, the extra height divides evenly, and nothing scrolls sideways; on production's layout before it, the test fails at the first size.

## Revisit if

- **The governor pauses the scene on ordinary phones**, or Lighthouse's total blocking time on Home rises past 200 ms. Then draw at 30 frames a second, or draw the floor once into a cached layer.
- **Home's HTML weight shows in its LCP** on a slow phone: the map is 15 KB of it. Then move the floor's paths into the data file and keep a lighter picture.
- **Joseph wants to turn the scene by hand.** Then the cube's three.js scene, loaded on intent as on the lab, is the right tool, not this renderer.
- **A reader says the scene distracts from the words.** Then it starts paused, and plays on intent.

## Patterns and further reading

- **One owner, many views**: the Route Lab's records, drawn by the lab, by its cube, by its social card and now by Home, each a view derived at build. Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 11, "derived data".
- **Progressive enhancement**: the picture is the page; the canvas improves it where it can run. Aaron Gustafson, *Adaptive Web Design* (2nd edition, 2015).
- **Load shedding**: the governor drops the pixel ratio, then pauses, rather than let a slow machine drop frames. *Site Reliability Engineering* (Google), chapter 21, "Handling Overload".
- **Fitness functions**: the budgets, the camera's agreement between picture and canvas, and the election's agreement with its stylesheet. Neal Ford, Rebecca Parsons and Patrick Kua, *Building Evolutionary Architectures*, chapter 2.
- **Breakout layout**: a page whose rows keep a reading measure while one element reaches the edges. Josh W. Comeau, "Full-Bleed Layout Using CSS Grid" (2021), which also explains why `100vw` is the wrong measure of the page's width.
- **Text that scales with the window, and zoom**: Maxwell Barvian, "Addressing Accessibility Concerns With Using Fluid Type" (*Smashing Magazine*, 2023), the source of the 2.5 rule `test/tokens.test.ts` holds.

## Postscript 2026-10-30

[ADR 0025](0025-signal-box-identity.md) gives Home a new order. It keeps this record's core, the Route Lab's day live behind the name and its lift into the space-time cube as the chapter scrolls up, and changes what stands around it. Top to bottom:

- **The stage, the first screen.** The map lies flat, north up and edge to edge, and its water is the page itself, so it needs no mask and has no edge. From 64rem the column stands on Puget Sound at every width: the name, 56 to 136 px in Barlow Condensed (it was 64 to 160 px); "Senior Software Engineer. Remote, US.", from the profile; the bio's opening; 5 h 34 min struck in muted over 3 h 12 min at the title's size, beside a stretch of the Routes line; the Email and LinkedIn buttons; and the caption as a sentence, such as "20 min into the day: 6 of 20 orders delivered.", then the map's credit. The readout's box of capitals is gone. Below 64rem the name, the role and the buttons lead the column, then a 300 px band of the map, then the opening and the figures, so the fold at 390 × 844 holds the name (186.7 px), the role (221.5 px) and the Email button (289.5 px).
- **The Route Lab's chapter**, the stage's second row, as before, its vans now a list written from the build's solve ("Van 1: 9 stops, Ravenna Park to International Fountain, back after 1 h 30 min"). The camera sways, and leans to the pointer, only as time stands up.
- **The board** takes the Raft Lab's chapter's place. It first covered the scene, with a fade at its top, so the cube was dimmed whole before it was covered instead of sliced mid-air, the audit's P1; a review the same day found the dimmed cube standing above the panel until the stage ended, so the scene now stands still only as far as the Route Lab chapter's end and leaves with it, and the board follows, under nothing. It draws every live lab as its line. The isometric election, `lib/iso.ts`'s story, its 15 s loop and `test/iso.test.ts` are retired; the board's Raft line, a hub and its spokes drawn from the Raft Lab's own run, takes its place. The header's pause button now pauses the scene and the board's day together.
- **How I work**, unnumbered, each lead at a section's size beside its evidence in the ink, not muted; **Writing**, as rows; **the close**, the address at the title's size, with no arrow, then LinkedIn.

What stands: the renderer, its governor, its pause and its reduced-motion picture; the larger-screen rule, which now reads "the room gets more of the city, not bigger type"; and the budgets, Home's first view now 95,296 B gzip -9 against 150,000, with the scene's lazy chunk at 5,332 B. None of this record's Revisit if conditions is known to have been met.

## Postscript 2026-10-31

**Below 64rem the scene is a picture in the page's flow, and it lifts with its own passage up the window.** Joseph read Home on his phone and scrolled: "I don't think you want the cross contamination ... It's about user experience." He was right. A running scene was a 300 px band held at the window's top from the buttons to the Route Lab chapter's end, and every word after the buttons scrolled under it: 3 h 12 min and the vans' days were cut in half at its edge, and once the chapter ended the cube still stood above the board, so one lab's picture lay over the rest of the site. The rule now, for every width: a section's picture belongs to that section, and nothing the scene draws covers a word.

- **Below 64rem** the column is the name, the role, the buttons, the bio's opening and the figures; then the scene, 351 px tall at 390 × 844 (under a screen wide and under seven tenths of a screen tall), with its caption under it; then the chapter. The figures say what VROOM saved and the chapter says how, so the picture stands between them, where the story tells it. It is never held at the window's top, live or still, and the band's `scroll-padding` and pointer rule are gone with it.
- **The lift follows the scene's own box** (`passing`, `scripts/route-scene.ts`): 0 while its foot is at the window's foot or below, 1 once its top reaches the window's top. Between those two it is wholly on screen, and `liftFor` plays the lift from a fifth of that stretch to nine tenths of it, so the whole lift is seen with the whole picture: at 390 × 844 it plays over 345 px of scroll, from the scene's top at 394 px to its top at 49 px. A scene that stands still cannot measure its own passage, so from 64rem the chapter coming up the window still drives it, as before.
- **From 64rem the scene's box starts where the column's words end.** The side-by-side stage stays, and the scene still stands still only to the chapter's end. Its box used to run under the column, and only a fade kept the cube from the words, at four tenths of its strength at their edge; now the box is what it draws in. The cube's room keeps the page's gutter from the words as from the window's edge, which makes it 2rem narrower at every width.
- **A fitness function holds the rule** (`e2e/scene-covers-nothing.spec.ts`): at 390 × 844, 768 × 1024, 1024 × 768 and 1440 × 900, with the scene running, it scrolls Home in steps of half a screen and fails if any visible heading, paragraph, list item, link or caption crosses the scene's box, or if the scene stands still below 64rem. On production's layout before this change it fails at all four sizes: below 64rem the scene is held, and from 64rem eight lines of the column cross its box.

**Not chosen: a picture held still with the words passing over it on cards**, The Pudding's scrollytelling and Scrollama's sticky graphic, which this record cites as prior art. It keeps the picture in view the whole time, but it needs the words recast as cards with their own ground, and the cards still cover the picture as they pass, so the rule fails the other way round: the picture is covered instead of the words. On a phone there is no room beside the words, so one of the two has to give way; in the page's flow neither covers the other, at the cost of the scene leaving the screen once it has been seen, which it should, since the chapter after it is about it.

**Door: two-way.** One stylesheet's rules, one function and the tests; the band is in history. It is wrong if readers on phones stop at the scene rather than read on, or if the lift is missed because it plays while the picture is still low on the screen.
