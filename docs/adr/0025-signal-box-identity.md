# ADR 0025: The site's identity is a signal box: a line per lab, lamps for state, Barlow and B612 Mono, Seattle on the water

Status: Proposed · 2026-10-30 · Deciders: Joseph Peterson · Supersedes in part [ADR 0010](0010-quiet-console-design-tokens.md) (the palette and the faces) · Amends [ADR 0022](0022-rail-as-index-and-row-links.md), [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md) and [ADR 0024](0024-home-led-by-the-work.md)

## Context

On 2026-10-30 Joseph asked for the site's look to change wherever it needed to: "update colors, fonts, sizes whatever you deem necessary to improve the site and to display what I am capable of doing for others."

An audit of the live site the same day (build `18534b4`, at 390, 1440 and 2560 px in both themes) found one great idea and a template around it:

- **The great idea.** The Route Lab's day runs live on a map of Seattle and lifts into the space-time cube as the visitor scrolls ([ADR 0024](0024-home-led-by-the-work.md)).
- **The template.** Everything else read as the developer-portfolio template: a near-black background with one warm accent, a giant name, and its chrome:
  - tracked, all-capital mono eyebrows over every page head ("LAB", "2 DEMOS", "POSTMORTEM") and both of Home's chapters;
  - middle-dot strings: "US · remote", "2026-10-25 · Postmortem", "20 orders · 3 vans · planned by VROOM", "LEADER · TERM 3", nine on Home and at least ten on the Route Lab;
  - arrows appended to links, nine on Home: "About me →", "Work ↓", "LinkedIn ↗", "Try it →";
  - 01 to 05 numbering on principles that are not a sequence;
  - mono for small labels: 128 mono elements on the Route Lab's page.
- **The colour.** The petrol background, `#08212a`, is ΔE_OK 0.033 from the navy `#0a192f` of Brittany Chiang's v4 template, under two just-noticeable differences. [ADR 0010](0010-quiet-console-design-tokens.md) measured it and relied on the apricot accent and the type to carry the difference; the audit read the site as that template anyway. Every surface sat between hue 205 and 231, so colour never marked a section.
- **The type.** About 15 sizes, some 1 px apart (15, 16 and 17 px; 10.5, 11 and 12 px), and three heading sizes within 20 to 28 px.
- **The motion.** Six effects beside the one orchestrated moment: titles rising on scroll, rules drawing themselves, tags decoding like a terminal, the card bar, the title handoff, the Raft cluster's 15 s loop, and an arrow that nudged.
- **The defects.** On a phone the Route Lab chapter's words ran through the scene (P0, fixed in pull request 43). The next card sliced the cube mid-air (P1). An arrow wrapped onto a line of its own, units were forced into capitals, map labels ran into each other, the 404's mark landed in the phone's header, the Raft cluster's labels rendered at 5.9 px on a phone, and the command menu drew two focus rings at once (P2).
- **The gap.** Nothing on the site showed the platform, data and infrastructure work Joseph does: queues, pipelines, caches.

Three directions were then drawn on the real content, at 1440 × 900 and 390 × 844 in both themes and at 2560 × 1440:

- **A, Signal box.** A railway signal box's mimic panel: each lab a line in its own colour, drawn as the real shape of its system, state shown by lamps; Barlow's condensed widths for signage; an enamel panel by night and by day.
- **B, Space-time.** The printed timetable: every system as a time-distance diagram (Ibry's and Marey's train charts, Lamport's message diagrams), light paper first, a reading serif.
- **C, Instrument, evolved.** Today's site with its tells removed: the condensed name, the live map with the page as its water, a darker green base, apricot as the Route Lab's colour.

Three judges scored each board from 0 to 10 on brief fit, distinctiveness, craft, feasibility in this codebase and fit with Joseph's own taste, each through one lens. The means:

| Direction | Craft lens | Feasibility lens | Joseph's lens | Mean |
|---|---|---|---|---|
| A, Signal box | **7.8** | 7.0 | **7.9** | 7.57 |
| B, Space-time | 5.8 | 5.2 | 6.2 | 5.73 |
| C, Instrument, evolved | **7.8** | **7.6** | 7.3 | 7.57 |

A won two lenses and C one, and their means tie. Every judge named the same fault in A, that it took the map and the cube lift off Home, and the same fault in C, that it is today's Home recoloured and composed more boldly; two added that its first screen says maps and route optimisation, with the other systems only a legend. Two judges chose A with C's map grafted on, and the third chose C with A's line drawings grafted on: both roads arrive at A's lines with C's map.

## Decision

### A signal box, with Seattle on the water

The site is Joseph's signal box. Each lab is a line in its own colour, drawn as the real shape of the system it simulates. Colour means one thing, which line; state is a lamp's shape and a word. Type is signage. Home's first screen keeps the site's best moment, the Route Lab's day live on Seattle, edge to edge, with the page itself as the water; below it, the board draws every live lab as a line on one panel. Direction A sets the system and direction C the Home map. [design-system.md](../design-system.md) holds every value; this record holds the decision.

### Colour means which line

- **The panel.** The page is a control panel's green enamel at night, `oklch(0.3 0.025 163)`, and the same panel by day, `oklch(0.94 0.008 165)`. The board is a recessed surface in it, all text is engraving, and `--primary` is the lit lamp: warm white at night, ink by day. The semantic names stay, so components barely changed.
- **A line per lab.** `--line-routes`, `--line-raft`, `--line-queue`, `--line-cache` and `--line-backfill`: strokes and lamps, never text, each 3:1 on the page, the board and a raised surface in both themes. A lab reaches its colour by its slug, `[data-line='routes'] { --line: var(--line-routes) }`, and a drawing uses `var(--line)`. Under full-severity colour-vision simulation the closest two lines are ΔE_OK 0.100 apart at night and 0.088 by day; hue is still never the only cue, since each line has its own shape and a written title.
- **State is a lamp.** Filled is done or in service, hollow is not yet, lit warm white is where the work is now, and a word says the same.
- **Maps lie on the water.** The water is the page's own colour and the land a raised surface, so a map has no edge where its data stops: on the Route Lab, in Home's scene and in the link preview.

### Type is signage

- **Faces.** Barlow in three widths and B612 Mono, all under the SIL OFL 1.1, cut from google/fonts at one pinned commit: Barlow Condensed SemiBold for the name, titles and figures; Barlow Semi Condensed Medium for the navigation, buttons, labels and captions; Barlow Regular for reading, with its SemiBold for `<strong>`; B612 Mono, drawn for Airbus's cockpit displays, for code and nothing else.
- **Eight sizes.** Hero 56 to 136 px, title 42 to 72, section 30 to 48, headline 24 to 28, lead 19 to 22, base 17 to 18, ui 15 to 16 and label 13 to 14, each linear from 390 to 1440 px, stopping at both ends, its maximum at most 2.5 times its minimum.
- **Labels** are sentence case, untracked and never mono. Numbers that change are tabular. Titles balance their lines; paragraphs set `pretty`.

### Pages

- **Everything stands flush left on one edge, ragged right.** Corners are square, lamps are the only round things, and there are no shadows. A rule is functional, 1 px of `--input`, or a lab's line, never a divider between rows.
- **The chrome.** From 80rem the rail holds the name and the role, except on Home, whose `<h1>` is the name; then Search, a field whose ⌘ is drawn, since Barlow has none; the navigation, Lab's pages each with a lamp in its line's colour and "View all demos" in words; and at its foot "Pause motion" and the theme in words. Below 80rem one top bar, 56 px tall. The footer is in the label face, with no dots.
- **Home, top to bottom.** The stage: the city live and edge to edge, the column standing on Puget Sound from 64rem, holding the name, "Senior Software Engineer. Remote, US.", the bio's opening, 5 h 34 min struck over 3 h 12 min beside a stretch of the Routes line, the Email and LinkedIn buttons, and the caption as a sentence. Then the Route Lab's chapter, each van's day written from the build's solve, as the day lifts into the cube; the scene leaves with the chapter's words, and the board follows, so no cube is sliced or left dimmed above the panel (since the review of 2026-10-30; it first faded the scene under the board's top); then How I work, unnumbered; Writing's rows; and the close.
- **The board.** A band per live lab, in the lab's order, each its title's link, its line and a describer in plain words, all worked out from the labs' own runs. Routes is the bakery's depot and a track per van, each stop a lamp placed by when the van reaches it; Raft is a hub and its spokes, then its log as lamps, filled once committed. Only live labs render: a section exists when it has content.
- **The Lab index** draws each lab's line large beside its title, its summary and one fact from its build. **A lab's page** runs its line across the head into a filled lamp, and sets the demo on a desk, the recessed surface in a 2 px bezel, its controls push-buttons whose lamp lights when pressed or chosen.
- **Writing and posts.** No eyebrows: a row is its title, its summary and its day in words, then its kind ("25 October 2026, postmortem"); a post has a register beside it from 64rem. **About** sets the name at the title's size and still prints on one Letter page. **The 404** draws a line ending in a buffer stop. **The command menu** marks its selected row with a raised surface and a lit lamp, one focus indication, and says "Up and down to move, Enter to open, Esc to close".

### Motion

Kept: Home's scene and its lift into the cube, the title a visitor follows becoming the next page's title, and the 2 px sweep along a row that leads somewhere, now in its lab's line. Added: the board's day, which lights the delivered stops from the bakery outward, 85 ms apart, the first time it is seen, then steps one van a stop each second, opacity only, in CSS, paused by the same button and still under reduced motion; since the review of 2026-10-30 it runs one day, from the middle of one to the middle of the next, and only while the board is in the window, so below 80rem, where the button is in the bar at the page's top, it never runs on out of sight. Removed: the rising titles, the rules that drew themselves, the tag decode, the Raft cluster's loop and the arrow nudge. Text never animates.

### Rules live in the build

`test/tells.test.ts` fails the build on the tells this wave removed: capitals or tracking in a stylesheet and a label tracked at all; a dot or an arrow in what a page says outside a post's body, or in a stylesheet's generated content; and a monospaced face on anything but code. It reads the sources and the build's own stylesheets, so a utility class in markup cannot slip one back, and each check has known answers copied from main before this wave, which it fails.

## Alternatives considered

- **B, Space-time** (5.73). Gains: one grammar for every system, and the most truthful pictures on any board, the Raft Lab as a Lamport diagram and a post's claim as a time-distance figure; engineers checking depth would recognise both. Costs: its type cannot ship. Its 66,184 B of fonts rested on a subset of about 110 glyphs; at the site's latin range the same faces come to about 91 KB, over the 70 KB preload budget, and its Literata files carry tables `test/fonts.test.ts` refuses. Its paper is ΔE_OK 0.003 from Tailwind's slate-50 and its night 0.045 from the template's navy, so it is the most generic surface of the three. It drops the condensed name, the map, the cube and the isometric Raft, which are what Joseph has kept, and it reads light-first and editorial, near the paper-and-red study he turned down on 2026-10-23. Rejected; its Lamport diagram is a candidate for the Raft Lab's own page later.
- **C, Instrument, evolved** (7.57). Gains: the best feasibility (7.6) and the best single picture on any board, the map with the page as its water, and the large-screen rule that a wider room gets more city, not bigger type. Costs: structurally it is today's Home recoloured, which is the "conservative ... playing it safe" reading Joseph rejected on 2026-10-29; it keeps three defaults, a big number over a caption, isometric plates in a grid and ruled hairlines through a post; and its first screen says "route optimisation", with the other systems a legend. Not chosen as the system; its map, its large-screen rule, the per-van facts from the solve and the 2 px sweep in a line's colour are grafted onto A.
- **A, as drawn** (7.57). Its own board took the map and the cube lift off Home for a lamp stepping once a second, filled 60% of the first screen with three hollow "being built" lines, and drew Raft as a racetrack ring, which misstates the protocol: a Raft leader sends to each follower directly. The judges asked for those three fixes, and the decision makes them: the map leads Home, only live labs render, and Raft is a hub and its spokes.
- **Fix the tells and keep Instrument's palette.** The least change: remove the eyebrows, dots, arrows and numbering, keep petrol and apricot. Gains: one day of work and no new fonts. Costs: the background stays 0.033 from the template's navy, every surface stays in one hue band, so colour still marks nothing, and nothing new says "systems". The audit's finding would stand. Rejected.
- **Two families, as the brief asked**: a condensed display face and a separate text face. Barlow ships as three families on Google Fonts, but it is one design by one designer, with one x-height, stroke and licence, in three widths; two unrelated families would sit further apart than Barlow's widths do. What the rule protects is the preload budget, and three Barlow files preload 39,788 B of the 70,000. So the rule is read as "one design", and the tests count faces and bytes, not family names.

## The architect's pass

### Why

Joseph's ask is a better-looking site; the need is a first screen that shows what he can do for a team. A recruiter gives Home seconds and a hiring manager for a platform role asks "what would he build for us". A picture of every system he can break, each drawn as its mechanism, answers that before a word is read, and the lines are the positioning line drawn. The look matters because the template look says "a developer site", and the content cannot overcome that on its own. If nothing is done, the site keeps reading as a template however good its labs get.

### Data ownership

| Data | System of record | Who writes it | Readers | How it crosses |
|---|---|---|---|---|
| Colour values, lines among them | `apps/web/src/styles/tokens.css` | Joseph, by pull request | every stylesheet through `var()`; the contrast test; the link preview and the `theme-color` metas | the build |
| A lab's colour by its slug | `[data-line]` rules in `global.css` | Joseph, by pull request | every drawing, as `var(--line)` | the build; `test/tokens.test.ts` holds slugs and line tokens one for one |
| The board's lines, the index's facts and their words | the labs' own runs: the Route Lab's solve of its default day (`routeLabPicture()`), the Raft Lab's opening run (`openingRun()`) | the build, deriving them in `lib/lines.ts` | `components/board/lines/`, on Home and on `/lab/` | at build; no figure is typed |
| The faces | `apps/web/scripts/fonts/fonts.lock.json`: each source by URL, sha256 and size | `scripts/fonts/build.sh --write` | Astro's Fonts API, the fallback faces, the link preview | the build; `test/fonts.test.ts` checks every served byte |
| The role line | `src/content/profile.json`, stamped by Joseph | Joseph | the hero, the rail | the build |

No datum gains a second owner. The board is a view of the labs, derived at build in the same commit, so it can never disagree with them; the weaker design types the board's numbers into the component, and the first change to a lab's default day makes the board lie.

### Prior art

- **Signal boxes and control rooms.** A railway signal box's mimic panel draws the lines as a schematic, with lamps where the trains are. Process control's high-performance HMI rules (ANSI/ISA-101.01-2015, and Bill Hollifield and others, *The High Performance HMI Handbook*, 2008) keep the background calm and reserve colour for meaning, with state shown redundantly. Both are what the site takes: colour for which line, a lamp's shape and a word for state.
- **Transit diagrams.** Harry Beck's London Underground diagram (1933) drew topology rather than geography, each line its colour and name; Massimo Vignelli's New York subway diagram (1972) took the same idea further. The board's lines are diagrams in that sense, the Route Lab's map the geography beside them.
- **One system, a variant per part.** MIT Media Lab's 2014 identity by Pentagram generates one mark per research group from one system; the site's sections already took that model for their drawings ([design-system.md](../design-system.md), "Page geometry").
- **The faces.** Barlow (Jeremy Tribby, 2017) takes after California's public signage, its licence plates, highway signs, buses and trains, so it is signage by origin. B612 began as Airbus's research with ENAC and the University of Toulouse into a face for cockpit screens, was drawn by Intactile DESIGN, and was published as open source in 2017; Google Fonts carries it under the OFL.

Nothing here is built that exists elsewhere: the faces are Google Fonts' static instances through the existing pinned pipeline, the contrast test is culori's, the board's day is CSS steps on a registered integer rather than a script, and the scene is the renderer [ADR 0024](0024-home-led-by-the-work.md) built.

### Combine before creating

| Piece | Responsible for |
|---|---|
| `styles/tokens.css` (existing) | every colour, the line colours among them, and the eight sizes |
| `[data-line]` in `global.css` (new) | a lab's colour by its slug |
| `lib/lines.ts` (new, pure) | each line's model and its words, from the labs' own runs |
| `components/board/lines/` (new) | one component per lab's line; the board and the Lab index draw the same ones, so a new lab joins both by adding one file |
| `styles/board.css`, `styles/lines.css` (new) | the board's panel and day; the lines' strokes and lamps |
| `scripts/fonts/cut.py` (existing, rewritten) | the five faces, their fitted fallbacks and the link preview's two statics |
| `test/tells.test.ts` (new) | the tells, held by the build |

## Consequences

- **Fonts.** Five files from google/fonts at commit `0b58fb37`, each pinned with its licence: three preloaded, 12,728 + 13,632 + 13,428 = 39,788 B, against Instrument Sans's 55,984 B; Barlow SemiBold, 13,560 B, fetched only where `<strong>` is drawn; B612 Mono, 12,084 B, declared only on a page with code. The Route Lab's first view declares 53,348 B of fonts instead of 64,140 B. Barlow draws no arrow, so no link or button carries one, and a footnote's way back is the word "Back". The link previews draw in the two condensed widths.
- **Budgets**, gzip -9, measured 2026-10-30 against main before this wave:
  - first views (HTML, CSS, the fonts a page declares, eager JavaScript): Home 106,189 → 95,296 B, the Route Lab 150,974 → 139,308 B, the Raft Lab 86,160 → 74,615 B, every one under its limit;
  - CSS: Home 12,776 → 12,944 B, the Route Lab 12,399 → 12,414 B, the Raft Lab 10,619 → 10,720 B, `/lab/` 9,255 → 10,242 B with the lines, every other page 9,255 → 9,241 B, all under 15,000 B;
  - eager JavaScript: Home and the indexes 4,213 → 3,951 B without the decode; content pages 2,239 → 2,260 B;
  - Home's scene, lazy: 5,153 → 5,332 B.
- **Tests.** `test/tells.test.ts` and `test/lines.test.ts` are new; `test/iso.test.ts` is gone with what it held. The contrast test gained the line role, the maps' land and the water-is-the-page rule; the font tests five faces, three preloads and mono only with code; glyph coverage reads a post by the face that draws each part; `e2e/motion.spec.ts` expects the sweeps and the board's day and nothing else. Each changed expectation changed with the design, and each new check has a known answer that fails on main.
- **IsoCluster is retired**, with `lib/iso.ts`'s story, its 15 s loop, `test/iso.test.ts` and the `--face-*` tokens, since nothing else used them. Joseph liked it. The board's Raft line takes its place: one drawing language instead of two beside each other, a hub and its spokes, which is how a Raft leader talks, drawn from the Raft Lab's own run, and no loop on the first screens.
- **Other records.** [ADR 0010](0010-quiet-console-design-tokens.md)'s palette and faces are superseded here; its ownership of the tokens, the copy-not-import rule and the contrast test stand. [ADR 0022](0022-rail-as-index-and-row-links.md)'s rail no longer names Joseph on Home, [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md)'s isometric pictures are gone, and [ADR 0024](0024-home-led-by-the-work.md)'s Home has a new order (its postscript of 2026-10-30).
- **Copy.** Only interface words changed. Nothing under `src/content/` did: the positioning line, the skills and the essay wait for Joseph's read.
- **What a new lab costs.** Its line colour exists already; it adds its line's component and its slug's `[data-line]` rule, and the board and the Lab index draw it.

## Door

Two-way in code. The colours are one file, the faces one lock, the scale one block and each line one component, all guarded by tests; going back is a revert of this wave's commits.

The public identity is closer to one-way. As [ADR 0010](0010-quiet-console-design-tokens.md) said of its accent, recognition accumulates in screenshots, link previews and people's memory, and none of that can be recalled; a second new palette within months would read as indecision. So the enamel and the lines' hues, and Barlow's voice, change only with an ADR of their own.

## Revisit if

- **Joseph's first read is "where is my map" or "too busy".** Then the board moves below How I work, or the stage gives the map more of the first screen.
- **Fewer than 3 of 5 readers in a 7-second test** ([product.md](../product.md)) name queues, caches or pipelines once those labs ship. Then the lines are not carrying the breadth, and the positioning line has to lead in words.
- **The board's lines draw few clicks to the labs**: fewer than one Home visit in ten goes on to a lab page in the first month after the new labs ship, once Web Analytics counts it (PR 3b). Then the board is decoration, and the lines need to be larger or the describers sharper.
- **A sixth lab cannot get a line colour** that reaches 3:1 on all three surfaces in both themes and stays four just-noticeable differences, ΔE_OK 0.08, from every other line under colour-vision simulation. Then a line's shape and pattern carry its identity, and hue becomes secondary.

## Patterns and further reading

- **Fitness functions**: the tells, the contrast pairs and the fonts' bytes, each held by a test with known answers. Neal Ford, Rebecca Parsons and Patrick Kua, *Building Evolutionary Architectures*, chapter 2.
- **Redundant coding of state**: colour for identity, shape and a word for state, so no reader depends on hue. Bill Hollifield and others, *The High Performance HMI Handbook* (2008).
- **The diagram as an interface**: Ken Garland, *Mr Beck's Underground Map* (1994).
- **One owner, many views**: the board and the Lab index as views of the labs, derived at build. Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 11, "derived data".
- **Semantic tokens**: names by role, values in one place. Nathan Curtis, "Naming Tokens in Design Systems".

## Postscript 2026-10-31

On a phone in daylight Joseph read the Cache line as the Raft line's colour. By day the Cache line was a brick red, `oklch(0.52 0.18 28)`, ΔE_OK 0.115 from the Raft line's crimson: "one colour per lab" held in the table and not on the screen. Two of the Route Lab's van colours borrowed the same way: by day van B's brick sat beside both lines, and at night van C's sky blue sat 0.053 from the Backfill line's cyan.

What changed, in every block that repeats the day values (the stored light theme, light from the OS, and print):

| Token | Before | After | Nearest line after, ΔE_OK | Contrast after, page / board / raised |
|---|---|---|---|---|
| day `--line-cache` | brick `oklch(0.52 0.18 28)` `#ba2c25` | burnt orange `oklch(0.535 0.15 46)` `#b04a01` | Routes, 0.137 (Raft 0.154, was 0.115) | 4.63 / 5.12 / 4.16 |
| day `--line-routes` | golden ochre `oklch(0.6 0.125 75)` `#ab7306` | dark yellow `oklch(0.59 0.12 100)` `#8e7e0b` | Cache, 0.137 | 3.44 / 3.80 / 3.09 |
| day `--map-van-a` … `d` | ochre, brick, steel, violet | dark yellow `oklch(0.38 0.075 95)`, brown `oklch(0.32 0.05 50)`, slate `oklch(0.37 0.035 240)`, indigo `oklch(0.27 0.11 287)` | slate to Queue, 0.148 | each 3:1 or more on every map fill |
| night `--map-van-b` … `d` | apricot, sky, lavender | amber `oklch(0.835 0.16 80)`, pale lilac `oklch(0.92 0.06 320)`, lavender `oklch(0.84 0.09 298)` | lavender to Backfill, 0.134 | each 3:1 or more on every map fill |

The night lines did not change.

The Routes line moved because the Cache line did. A search of the sRGB gamut on 2026-10-31 found no orange at hue 45 to 55, chroma 0.14 or more, that keeps 3:1 on a raised surface and sits more than 0.130 from the day ochre (a darker, greyer one does, and reads as brown): a light theme has room for an ochre or an orange, not both, since neither can be light. At hue 100, its night hue, the day Routes line is a dark yellow and the pair sits 0.137 apart.

`test/tokens.test.ts` now holds the rule as a fitness function: in each theme, every two lines sit ΔE_OK 0.133 or more apart, and every van sits that far from every lab's line but the Route Lab's. The floor comes from the measured pairs: every pair readers took for one colour sat at 0.130 or under, and the nearest pair nobody confused, the night Raft and Cache lines, at 0.142. It sits low in that gap because the night map has no more room, which is this postscript's open question: van D shares van A's square stops, so it stays 20 apart in CIEDE2000 from A's yellow under every simulated deficiency, and no colour that does, on the night fills, sits more than 0.135 from the Raft and Backfill lines. Four van colours, five lab colours and the bands' green fill the night's hue circle, and the vans pay for it among themselves (A and B 0.078 apart at night). Its known answer is the values of 2026-10-30, which fail it on seven pairs.

The decision stands; this is the condition under Revisit if, "a sixth lab cannot get a line colour", arriving early for the vans. If a sixth lab ships, or the night vans read as one colour, the proper design is the one that condition names: the Route Lab's vans told apart by stop shape and dash first, with one shape per van, so their colours no longer have to share the night with five labs.
