# ADR 0027: The site's design follows Joseph's references: a light technical drawing, a top bar, his system drawn isometrically

Status: Proposed · 2026-10-31 · Deciders: Joseph Peterson · Supersedes in part [ADR 0025](0025-signal-box-identity.md) (the palette, the faces, the rail and the signal-box chrome), [ADR 0024](0024-home-led-by-the-work.md) (Home's composition) and [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md) (the rail's drop-downs) · Amends [ADR 0021](0021-rail-and-living-ground.md) and [ADR 0022](0022-rail-as-index-and-row-links.md) · The plan for builders: [docs/design/overhaul.md](../design/overhaul.md)

## Context

On 2026-10-31 Joseph asked for the site to be overhauled ("God damn. Overhaul the site please."). He had rejected two rounds the same day: a token swap that kept the old layout ("looks almost identical to what we started with"), and three directions invented without his references ("not what I am talking about at all. Look again at the example websites I gave you").

His references define the direction, and a client's references outrank a designer's defaults:

- **[syntaqx.com](https://www.syntaqx.com/)**, the one he named, and the nearest to his work: a light, airy page with one strong accent; a bold condensed name; short named bio blocks (Currently, Previously, Otherwise); an isometric drawing of a system's architecture beside the bio; a stats row; an activity heatmap; tool cards; a dated writing list; a top nav with search and a theme toggle.
- **brittanychiang.com**: the same idea dark, in two columns, the left one sticky.
- **taniarascia.com**: a friendly introduction, a brief timeline, an illustration.
- **leerob.com**: minimal, a bio and lists.

His own words: "most start with an about me that scrolls downward with some 3d/animations", "techno", "cool things and animations", "clean and easy to navigate".

The site as it stood (build `4325d50`) was the signal box of [ADR 0025](0025-signal-box-identity.md): a grey-green enamel, Barlow in three widths, a rail down the left edge from 80rem ([ADR 0021](0021-rail-and-living-ground.md), [ADR 0022](0022-rail-as-index-and-row-links.md), with drop-downs from [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md)), and Home led by the Route Lab's live map of Seattle ([ADR 0024](0024-home-led-by-the-work.md)). Its palette already sat near syntaqx's grey-green, so a recolour toward the reference would have looked like neither a change nor his.

## Decision

Follow the references' format, and make every part of it his.

- **Format.** A light page by default with a dark theme; one top bar on every page and at every width (wordmark; Lab, Writing, About; Search through the existing command menu; the theme toggle), replacing the rail; Home opens with the name and short named bio blocks beside an isometric drawing, then a stats row, the labs as cards, a decision log, a dated writing list.
- **Palette: a technical drawing.** Drafting paper `#f5f7fb`, Prussian ink `#0f1836`, one accent, cobalt `#2349d7`; by night the same drawing as a blueprint, `#10234f` with a lit cobalt `#a2bcff`. The labs keep their line colours inside their own drawings, never in the chrome. Light is the bare `:root`; dark is a stored choice or the OS's.
- **Type: one family across its width axis.** Archivo (Omnibus-Type, OFL), cut by the repository's pinned font pipeline into static instances: ExtraCondensed ExtraBold for the name and titles, Expanded Medium for signage (the nav, dates, block names), Condensed SemiBold for controls and the labels inside drawings, Regular for reading; B612 Mono stays for code. Width says the role. The name alone is set in capitals.
- **The drawing is his system**: the five labs wired into one architecture on an isometric ground plane, each solid a link to its lab, drawn as SVG at build. It explodes as the visitor scrolls (CSS scroll timelines), and stands still otherwise and under reduced motion.
- **Every figure is derived at build** from its system of record; the reference's commit heatmap becomes a decision log drawn from the ADRs.

The foundation ships first, on `feat/overhaul`: the tokens, the faces, the base styles (type, links, buttons, cards, focus), the top bar, the footer and the frame, with every existing page running on them. The pages are then laid out anew on it.

### What this supersedes

| Record | Superseded | Kept |
|---|---|---|
| [ADR 0025](0025-signal-box-identity.md) | The enamel palette and night-first default; Barlow and its three widths; "Everything flush left against the rail", square corners everywhere, the lamp as the chrome's state mark, the rail's controls in words; the board on Home | One colour per lab as `--line-*` and `[data-line]`, held 0.133 apart; labels sentence case, untracked, never mono, no dots, no arrows (`test/tells.test.ts`, now allowing capitals on `.nameplate` alone); B612 Mono for code; the contrast tests |
| [ADR 0024](0024-home-led-by-the-work.md) | Home led by the Route Lab's live map behind the name; the scene's lift into the cube on Home (it stays on the Route Lab's own page); the motion button once the scene goes | The rule that Home leads with the work, now drawn as his whole system rather than one lab |
| [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md) | The rail's drop-downs; Home told as a story with isometric pictures per chapter | An isometric drawing as Home's picture, now one drawing of the system |
| [ADR 0021](0021-rail-and-living-ground.md), [ADR 0022](0022-rail-as-index-and-row-links.md) | The rail from 80rem | A row of an index is its link; the search field opens the command menu |

## Alternatives considered

- **Recolour today's layout** toward the references (the first round). Cheapest, and Joseph rejected it on sight: the rail, the map and the board survive, and the site reads as before.
- **An invented direction** (the second round's three). Each was defensible on its own terms and none was what he asked for; he named his references twice.
- **Copy syntaqx closely**: teal on grey-green, its drawing's DNS, CDN and load balancer, its tracked capital labels. Fastest to the look he likes, but it is another person's identity, its palette is today's site's, and its labels are the tells ADR 0025 removed for cause.
- **Brittany Chiang's dark two-column as the default.** He listed it, but named syntaqx; a dark default near her navy is the template ADR 0025 measured the old site against. Kept as the dark theme's spirit (a blueprint, not her navy) and as /about/'s two columns.
- **Two unrelated families** (a condensed display face and a separate text face, as syntaqx sets). Two families sit further apart than one family's widths, and cost the same bytes; Archivo's width axis gives the same contrast with one design, one licence and one pipeline entry.

## The architect's pass

### Why

The ask is a new look; the need is a first screen that tells someone deciding whether to hire or work with Joseph what he builds, in seconds, in a form they already know how to read. His references are that form, and he has said so three times.

### Data ownership

| Data | System of record | Writer | Readers | How it crosses |
|---|---|---|---|---|
| Colours | `apps/web/src/styles/tokens.css` | Joseph, by pull request | every stylesheet by `var()`; `test/tokens.test.ts`; the link preview; the `theme-color` metas | the build |
| Faces | `apps/web/scripts/fonts/fonts.lock.json`, each source by URL, sha256 and size | `scripts/fonts/build.sh --write` | Astro's Fonts API; the fallback faces; the link preview's two `.ttf` | the build; `test/fonts.test.ts` checks every byte |
| The words | `apps/web/src/content/` (stamped) | Joseph | every page | the build; this ADR changes no word |
| Stats and the decision log | the labs' builds (`lib/lab.ts`), the sweeps, `docs/adr/`, `lib/posts.ts` | the build | Home | derived at build; no figure is typed |
| The nav | `apps/web/src/lib/nav.ts` | Joseph | the top bar, the footer, the command menu, llms.txt | the build |

No datum gains a second owner. The weaker design types "26 decision records" into Home, and the next ADR makes it a lie.

### Prior art

Built from proven parts: Astro's Fonts API with the existing pinned cutter (fontTools' instancer, used since ADR 0025 for the fallback faces); the existing command menu as the search; CSS scroll-driven animations (`animation-timeline: view()`, in Chromium since 115 and Safari 26) for the drawing's one motion instead of a JS library; isometric projection as plain SVG at build, the convention of cloud architecture diagrams (AWS publishes an isometric icon set for them) and of syntaqx's own drawing. Archivo is Omnibus-Type's grotesque, published with a width axis of 62 to 125 under the OFL.

## Consequences

- **Fonts.** Six files: four preloaded on every page, 11,800 + 12,272 + 11,900 + 12,272 = 48,244 B of the 70,000 B budget (Barlow's three were 39,788 B); Archivo SemiBold, about 11.4 kB, only where `<strong>` is drawn; B612 Mono only with code. The label face matches Barlow Semi Condensed's width on the labs' own words, so their controls keep their rows on a phone.
- **CSS.** Home 13,204 B, the Route Lab 12,849 B, every other page 9,384 to 10,320 B, all under 15,000 B. Eager JavaScript unchanged.
- **Tests.** Tests that pinned the old design were replaced with tests of the new one: the rail's (`e2e/rail-and-scene.spec.ts`, `e2e/index.spec.ts`, `e2e/layout.spec.ts`) by `e2e/top-bar.spec.ts`; the footer's one line by its two columns; the card's sweep by its state; the palette's two buttons by one Search at every width; the font names and counts; the theme blocks' order. Every invariant stands: CSP, budgets, axe in both themes, the phone project, links, review stamps, the firewall.
- **Known gap.** Home is still ADR 0024's composition on the new chrome until its rebuild; one of its old checks (`e2e/rail-and-scene.spec.ts`, "Home's column on a tall screen", at 2560 and 3440 px) misses by 0.8% of the window and goes with that composition.

## Door

Two-way in code: one tokens file, one font lock, one header and one footer, each held by tests; a revert restores the signal box.

Closer to one-way in public: recognition builds in screenshots, link previews and memory. This is the third palette in a month, so the light paper, cobalt and Archivo change again only by an ADR of their own, and only on evidence below.

## Revisit if

- **Joseph's first read is "still not it"** once Home is rebuilt to this plan. Then sit with him over syntaqx's page and mark what to take, part by part, before drawing anything else.
- **Fewer than 3 of 5 readers in a 7-second test** ([product.md](../product.md)) can name two of queues, caches, pipelines or consensus from Home's first screen. Then the drawing's labels are not carrying the breadth.
- **Fewer than one Home visit in ten opens a lab** in the month after launch (Web Analytics). Then the drawing is decoration, and its solids need to read as doors.
- **A face's preload passes 60,000 B** with a new width or language. Then cut the wide face to the nav's characters or drop it for the label face.

## Patterns and further reading

- **Design tokens by role**: Nathan Curtis, "Naming Tokens in Design Systems".
- **Fitness functions** for contrast, faces and tells: Neal Ford, Rebecca Parsons and Patrick Kua, *Building Evolutionary Architectures*, chapter 2.
- **The type scale**: Robert Bringhurst, *The Elements of Typographic Style*, 3.1.1.
- **Derived data, one owner**: Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 11.
