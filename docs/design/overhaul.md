# The overhaul: the design plan

> Home's section here is superseded by [home.md](home.md) ([ADR 0028](../adr/0028-home-is-his-own.md)): it laid Home out as a reference's homepage, composition and signature included. The palette, the faces, the top bar, the footer and the other pages stand.

Status: the plan for builders, 2026-10-31 · Decision: [ADR 0027](../adr/0027-design-follows-josephs-references.md) (Proposed) · Foundation on `feat/overhaul`

This file is what every builder of the overhaul works from: the subject, the tokens, the type, each page's layout, the components with their class names, and the principles. The foundation (tokens, fonts, base styles, the top bar, the footer, the page chrome) is built; the pages are laid out anew on it, wave by wave. Where this plan and an older section of [design-system.md](../design-system.md) disagree, this plan wins until design-system.md is rewritten to match.

## 1. The subject

- **Who.** Joseph Peterson, a senior software engineer working toward architecture. He builds the systems work flows through: queues, data pipelines, caches, clusters on two clouds, and the lines where coding agents write the code.
- **Who reads it.** Someone deciding in under a minute whether to hire him or work with him: a hiring manager for a platform or data team, a staff engineer checking depth, a founder.
- **The page's job.** Show what he can build, and let them break it. Its assets, strongest first: five live labs, seeded simulations you can break in the browser (Routes, Raft, Queue, Cache, Backfill); an essay; the decision records.
- **The client's references** (they win over any default): [syntaqx.com](https://www.syntaqx.com/), the one he named, closest to his world; brittanychiang.com; taniarascia.com; leerob.com. His words: "most start with an about me that scrolls downward with some 3d/animations", "techno", "cool things and animations", "clean and easy to navigate".
- **What he rejected.** A token swap that kept the old layout, and three invented directions. So the format follows the references: a light, airy page, a top nav with search and a theme toggle, a bold condensed name, short named bio blocks, an isometric architecture drawing beside the bio, a stats row, cards, a dated writing list.

What makes it his, not syntaqx's: the drawing is **his system**, the five labs wired into one architecture, each part a link to the lab that runs it; the numbers are **derived from his builds**; the palette is a technical drawing's, cobalt on drafting paper by day and a blueprint by night; the type is one family across its width axis.

## 2. Colour

Six values carry the design. Every other token in `apps/web/src/styles/tokens.css` (the labs' lines, the maps) is a role inside a lab's own drawing and never the chrome.

| Name | Token | Light (default) | Dark (the blueprint) | Role |
|---|---|---|---|---|
| Drafting paper | `--background` | `#f5f7fb` `oklch(0.975 0.006 265)` | `#10234f` `oklch(0.27 0.085 264)` | the page; the water on every map |
| Sheet | `--surface-1` | `#ffffff` `oklch(1 0 0)` | `#1a2e5b` `oklch(0.31 0.085 264)` | the top bar, cards, a lab's desk, the footer |
| Prussian ink | `--foreground` | `#0f1836` `oklch(0.22 0.06 268)` | `oklch(0.96 0.015 255)` | all text; every edge of the drawing |
| Graphite | `--muted-foreground` | `#495472` `oklch(0.45 0.05 268)` | `#b0c6e5` `oklch(0.82 0.05 258)` | captions, dates, the nav at rest |
| Grid | `--border` | `#d9dee8` `oklch(0.9 0.014 265)` | `#314673` `oklch(0.4 0.08 264)` | hairlines: the bar's edge, a list row, a stat's cell |
| Cobalt | `--primary` | `#2349d7` `oklch(0.48 0.22 266)` | `#a2bcff` `oklch(0.8 0.1 268)` | the one accent: the primary button, focus, the current page, the lit path in the drawing |

Supporting tokens, all in `tokens.css`: `--surface-2` (raised: hover, pressed, code; light `#e7ebf4`), `--ground` (a background band such as the stats row), `--input` (a rule that works: a control's edge, 3:1), `--primary-strong` (cobalt's hover), `--primary-foreground` (text on cobalt), `--ring` (focus, = cobalt), and the isometric drawing's fills: `--iso-top`, `--iso-left`, `--iso-right` (the three faces of a solid, lit from the top left) and `--iso-grid` (the plane's grid, translucent). The labs keep `--line-routes`, `--line-raft`, `--line-queue`, `--line-cache`, `--line-backfill`, reached by `[data-line='<slug>'] { --line: … }`.

Rules:

- **Light is the default.** The bare `:root` holds the light theme; dark is a stored choice (`[data-theme='dark']`) or the OS's (`@media (prefers-color-scheme: dark)`), the two copies held equal by `test/tokens.test.ts`.
- **One accent.** Cobalt marks what a visitor can act on and where they are. It never decorates. A headline never colours one word.
- **Lab colours live inside lab drawings.** A card, a row, the nav: never a lab's colour.
- **Every colour is in `tokens.css`.** The contrast test reads it: text 4.5:1 and working rules 3:1 on every surface, in both themes.

## 3. Type

One family, **Archivo** (Omnibus-Type, SIL OFL 1.1), across its width axis: width says the role. Self-hosted through `apps/web/scripts/fonts/` (cut from google/fonts' variable font at commit `0b58fb37`, each a static instance, latin subset, unhinted).

| Face | Instance | Token | Role | File | Loaded |
|---|---|---|---|---|---|
| Display | ExtraCondensed ExtraBold (wdth 62, wght 800) | `--font-display` | the name, page titles, card and row titles, figures | `archivo-condensed-extrabold.woff2`, 11,800 B | preloaded |
| Wide | Expanded Medium (wdth 125, wght 500) | `--font-wide` | signage: the wordmark, the nav, Search, a block's name, dates, stat captions, the footer | `archivo-expanded-medium.woff2`, 12,272 B | preloaded |
| Label | Condensed SemiBold (wdth 75, wght 600) | `--font-label` | buttons, controls, keys, labels inside drawings, where room is short | `archivo-condensed-semibold.woff2`, 11,900 B | preloaded |
| Text | Regular (wdth 100, wght 400) | `--font-sans` | reading | `archivo-regular.woff2`, 12,272 B | preloaded |
| Strong | SemiBold (wdth 100, wght 600) | `--font-sans` at 600 | `<strong>` | `archivo-semibold.woff2`, about 11.4 kB | on demand |
| Code | B612 Mono Regular | `--font-mono` | code and nothing else | `b612-mono-regular.woff2`, 12,084 B | only on a page with code |

Preloaded on every page: 48,244 B of the 70,000 B budget. The label face matches the old Barlow Semi Condensed's width on the labs' own words (0.394 em a letter against 0.419), so the labs' controls keep their rows.

**Scale** (`tokens.css`, `--text-*`), on the classic scale of *The Elements of Typographic Style*, each fluid from 390 to 1440 px and stopping at both ends, maximum at most 2.5 times minimum (SC 1.4.4):

| Step | Size | Line height | Face | Used for |
|---|---|---|---|---|
| `hero` | 48 → 104 px, capped at 15vw | 0.9 | display, capitals | the name on Home (`.nameplate`) |
| `title` | 40 → 64 px, capped at 12.5vw | 0.95 | display | a page's `<h1>`, a stat's figure |
| `section` | 28 → 40 px | 1 | display | a section's `<h2>` |
| `headline` | 21 → 26 px | 1.15 | display | a card's, a row's or a post's `<h2>` |
| `lead` | 19 → 21 px, capped at 11.5vw | 1.5 | text | a page's lead, the bio's blocks |
| `base` | 17 → 18 px | 1.6 | text | prose, card text |
| `ui` | 14 → 15 px | 1.25 | wide or label | the nav, buttons |
| `label` | 12.5 → 13.5 px | 1.4 | wide or label | a block's name, a date, a caption, a key |

Rules: left aligned, ragged right, everywhere. Reading measure `--measure: 31em` (about 68 characters of Archivo). Labels are sentence case, untracked, never mono (`test/tells.test.ts`). **The name is the one thing set in capitals**, by `.nameplate` alone, which the tells test allows by its selector. No arrow glyph anywhere (no face draws a sideways arrow); no middle-dot strings; no word accented in a headline. Titles `text-wrap: balance`, paragraphs `pretty`. Numbers that change are tabular.

## 4. Shape, space and motion

- **Corners by hierarchy**: the bar and full-width bands square; a control `--radius-md` 4 px; a card or a lab's desk `--radius-lg` 8 px; inline code `--radius-sm` 2 px. No shadow but the open command menu's.
- **The frame** (`.frame`): 81rem wide, centred, padding `--frame-pad` (1.125rem below 48rem, 2.5rem from 48rem), so content is 76rem (1,216 px) at most. A box that reaches the window's edge (Home's stage, the Lab index's lines) takes `--frame-pad` back. `--gutter`: 1rem, 1.5rem from 48rem, 2rem from 64rem.
- **Vertical rhythm**: a section opens 3.5rem below the last (6rem from 48rem); the footer stands 4rem below main (7.5rem from 48rem).
- **Hairlines carry structure**: the bar's lower edge, a writing row's top, a stat's cell, the footer's copyright line. Never a divider for its own sake.
- **Motion**: nothing moves after the first paint unless the visitor scrolls or opens something. No entrance on load, no loop, no hover transition on a card. Allowed: the drawing's scroll-linked explode (below), a row's 2 px sweep on hover, the followed title's view transition, a lab's own run once the visitor presses Run. All of it inside `@media (prefers-reduced-motion: no-preference)`; reduced motion gets a still picture. The `phone` Playwright project (`e2e/steady.spec.ts`) holds it.

## 5. Components

### Top nav (built): `components/Header.astro`

```
desktop, 56 px, white sheet, hairline under
┌────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Joseph Peterson    Lab   Writing   About             [⌕ Search      ⌘K]  ◐   │
│                      ═══ (2 px cobalt under the current section)                │
└────────────────────────────────────────────────────────────────────────────────┘
phone (390), one row, 56 px
┌──────────────────────────────────────┐
│ ◆   Lab  Writing  About      ⌕    ◐  │
└──────────────────────────────────────┘
```

Classes: `.masthead` (the full-width band: `--surface-1`, hairline under), `.skip-link`, `.site-header` (flex row, wraps only when it must), `.wordmark` (`.wordmark-tile`, a cobalt rhombus, the drawing's ground tile; `.wordmark-name`, hidden on screen below 40rem and still read), `.site-nav` (each item one link; `[aria-current]` gets the 2 px cobalt `::after` on the bar's edge), `.header-tools` (`.palette-item` > `.search-open` with `.search-glass`, `.search-word` and `Keys`; `.motion-item` on Home while its scene exists; `ThemeToggle`). Search opens the existing command menu (`components/Palette.astro`); it shows once the script binds it, on every width; its keys only where a fine pointer can hover. Never fixed to the window.

### Footer (built): `components/Footer.astro`

```
──────────────────────────────────────────────── hairline, white sheet
Joseph Peterson                                        RSS   LinkedIn
Senior Software Engineer
hello@ihaveasegway.com
────────────────────────────────────────────────
© 2026 Joseph Peterson
```

Classes: `.site-foot` (the band), `.site-footer` (the frame; a grid, two columns from 48rem), `.footer-who` (`.footer-name` in display, `.footer-role`, `.footer-email`), `.footer-links`, `.fine-print`. Words: the profile's and the nav manifest's only.

### Buttons (built): `.btn`, `.btn-primary`

Label face, `--text-ui`, 44 px tall, 4 px corners. Primary: cobalt fill, white text, one a screen. Secondary: an outline in `--input`, `--surface-2` under the pointer. A toggle (`aria-pressed`, or `data-lamp`) shows a small round lamp before its words, filled with cobalt when on. No arrow in a label: "Open the Queue Lab", not "Try it →".

### Cards (built): `.cards`, `.card`, `.card-title`, `.card-text`, `.card-more`

White sheet on the paper, a hairline edge, 8 px corners, no shadow. Title in display at `headline`. A card that leads somewhere is its link (the stretched `.card-more`); under the pointer its edge darkens to `--input` and its title turns cobalt, at once. A card that leads nowhere does not react. A lab's card carries `data-line` so a glyph inside it can draw in the lab's colour; the card's own edge never does.

### To build on this foundation

- **Bio blocks** (`.bio-blocks`, `.bio-block`, `.block-label`): Home's opening, after syntaqx's Currently/Previously/Otherwise, in his approved words from `src/content/about.md`: **Now** is about.md's first paragraph, **What I build** its five items as a short list, **Working toward** its last section. `.block-label`: wide face, `label` size, cobalt, sentence case. The section names are content's; no other label stands over a block.
- **Nameplate** (`.nameplate`): `font: 800 var(--text-hero)/var(--text-hero--line-height) var(--font-display); text-transform: uppercase; margin: 0`. One line from 390 px ("JOSEPH PETERSON" is 6.8em). Add `.nameplate` to the display-type `::selection` rule in global.css.
- **The isometric drawing** (`components/iso/System.astro`, `.iso`): see 6.
- **Stats row** (`.stats`, `.stat`, `.stat-figure`, `.stat-caption`): a `<dl>` of four cells on `--ground`, hairlines between cells, a figure in display at `title`, its caption in wide at `label` under it. Two cells a row below 48rem. Every figure derived at build from its system of record, never typed: the live labs (`lib/lab.ts`), the seeded runs a pull request checks (the labs' sweeps), the decision records (`docs/adr/`), the posts (`lib/posts.ts`). No "+" or star glyph after a figure.
- **Decision log** (`.decisions`): his answer to syntaqx's activity heatmap, from data he owns: each ADR a tick on a date axis, its number and title on hover and focus, the latest five listed under it with their dates. Built at build time from `docs/adr/*.md` front lines. No commit heatmap: it would be a second owner of git history and says nothing about judgment.
- **Lab cards** (`.lab-cards`, `.lab-card`): the five labs as tool cards, two or three a row, each with its glyph cut from the drawing (`.iso-glyph`, in its lab's colour), its title, its summary and one fact from its build. The whole card is its link.
- **Writing list** (`.post-list`, `.post-row`, `.post-date`, `.post-title`, `.post-summary`, `.post-kind`): a dated list as syntaqx's, three columns from 48rem: the date in wide at `label` (`31 Oct 2026`), the title in display at `headline` with its summary under it, the kind at the row's end. A hairline above each row; the row is its title's link; the 2 px cobalt sweep along its top on hover is the one motion.

## 6. The isometric drawing

The memorable thing, and the one place the design spends its boldness. **His system, drawn as one architecture**: a request comes in at the left and flows through his five labs, each a solid on one isometric ground plane, wired along the plane's axes:

```
                      ┌───────── ground plane, 30° isometric, --iso-grid ─────────┐
   requests ─▶ [ Routes: WASM planner ]─▶[ Queue: broker ▣ ]─▶[ workers ▢▢▢ ]
                                               │
                    [ Cache: nodes ◫◫◫◫ ]◀─────┴────▶[ Raft: 5 servers ⬡ ]
                              │                               │
                              ▼                               ▼
                       [ database ⛁ ]──── nightly ───▶[ Backfill: warehouse ⛁ ]
```

- **Built as SVG at build** (`components/iso/System.astro`, the geometry in `lib/iso/system.ts`, pure and unit-tested): an isometric projection of a small model of boxes, cylinders and wires. No JS library, no WebGL. Solids are filled `--iso-top`, `--iso-left`, `--iso-right` and edged 1.25 px in `--foreground`; the plane's grid `--iso-grid`; wires 1.5 px in `--input`; the live path 2 px in cobalt. Labels in the label face at `label`, sentence case, each a solid's lab name.
- **Each solid is a link** to its lab (`<a href="/lab/queue/">` around its `<g class="iso-node" data-line="queue">`), with its name as the link's text for assistive technology. Focus or hover lights that lab's wires in its line's colour (a state, no transition).
- **The motion is the visitor's scroll.** At rest, and under reduced motion, the drawing is assembled. As the hero scrolls up the window, the layers lift apart along the vertical axis into an exploded view, CSS only: `animation-timeline: view()` on `.iso-layer` translating along y, inside `@supports (animation-timeline: view())` and `prefers-reduced-motion: no-preference`. Where the browser lacks scroll timelines, the picture stays assembled. Nothing moves on load.
- Placement: beside the bio from 64rem (the right 6 of 12 columns), under the bio blocks below 64rem, so a phone opens on the about-me as the references do (the lift then follows the drawing's own passage up the window, a `view()` timeline), never taller than 60svh on a phone. It must not be syntaqx's drawing: no DNS, CDN or LB labels, no stacked translucent planes, no teal.

## 7. Pages

All left aligned on the frame's edge.

**Home**

```
[top nav]
┌───────────────────────────────────┬──────────────────────────────────────┐
│ JOSEPH PETERSON        (nameplate)│                                      │
│ Senior Software Engineer. Remote, │      the isometric system drawing    │
│ US.                (wide, label)  │      (five labs, wired; each a link) │
│ Now                (block-label)  │                                      │
│ I'm a software engineer who…      │                                      │
│ What I build                      │                                      │
│ queues · caches · pipelines …     │                                      │
│ Working toward                    │                                      │
│ Systems where the hard part…      │                                      │
│ [Email hello@…]  [LinkedIn]       │                                      │
└───────────────────────────────────┴──────────────────────────────────────┘
│ 5 live labs │ 3,000 seeded runs │ 26 decision records │ 2 posts │  (stats, --ground)
Lab                                                     View all demos
┌ lab card ┐ ┌ lab card ┐ ┌ lab card ┐ ┌ lab card ┐ ┌ lab card ┐   (2 or 3 a row)
Decision log (ticks on a date axis, the latest five listed)
Writing                                                 All writing
31 Oct 2026   The road closed. The stops didn't.               essay
              Writing code by hand was how…
How I work (the bio's principles, two columns from 64rem)
[footer]
```

(The `·` above is the sketch's, not the page's: What I build is a list.) Phone: the nameplate, the role, the drawing, the blocks, the buttons, then the rest in one column.

**/lab/**: the page head (title "Lab", lead), then the five lab cards, larger: the glyph across the card's top, the title, the summary, one fact, two a row from 64rem.

**A lab's page chrome**: a breadcrumb-free head (the nav marks Lab): the title in display at `title`, the lead, then the demo on a desk (`.desk`: `--surface-1`, hairline edge, `--radius-lg`), then the write-up in a reading column with the register beside it from 64rem. The lab's colour appears only inside its drawing. Each lab keeps its controls' words and its steady-on-a-phone tests.

```
[top nav, Lab marked]
Crash the workers behind a queue          (title)
Three workers take the bakery's orders…   (lead)
┌──────────────── desk ────────────────────────┐
│  the lab's picture, in its line's colour      │
│  Time [Run] [Next event] [Start over]          │
└───────────────────────────────────────────────┘
How it works (prose, measure)      │ register (from 64rem)
```

**/writing/**: the head, then the dated writing list (above), RSS feed at its foot.

**A post**: the title at `title`, the date and kind under it in wide at `label`, the body at `base` in the measure, the register beside from 64rem; code in B612 Mono on `--surface-2`.

**/about/**: brittanychiang's two columns from 64rem: the left sticky (the name at `title`, the role, the addresses as `.kv`, Print), the right scrolling (the bio's blocks, the roles, the skills, the work cards). It still prints on one US Letter page (`e2e/about-print.spec.ts`).

**404**: the drawing with one solid missing and its place drawn dashed, the existing words ("Page not found", "There is no page at this address.") beside it, and "Go to the home page" as the primary button. The old buffer-stop line (`.line-end`) and About's wheels (`.ground`) go with the signal box.

```
[top nav]
┌──────────────────────┬────────────────────────┐
│ Page not found       │  drawing, one solid    │
│ There is no page at  │  dashed where it was   │
│ this address.        │                        │
│ [Go to the home page]│                        │
└──────────────────────┴────────────────────────┘
```

## 8. Principles

1. **The drawing is the hero, and it is his system.** Every part a lab you can open and break.
2. **Light and airy, one accent.** Drafting paper, Prussian ink, cobalt for what you can act on; a blueprint by night.
3. **Width is the role.** Condensed to name things, expanded to sign things, normal to read.
4. **Every figure is derived.** No number is typed into a component.
5. **Motion answers the visitor.** Scroll explodes the drawing; nothing moves on its own.
6. **Easy to navigate.** Three items and Search, the same on every page and every width, nothing behind a menu button.
7. **Spend boldness once.** Everything around the drawing stays quiet: no gradient washes, no glow, no eyebrow over every heading.

## 9. Review against the brief and the defaults

The plan was checked against the skill's list of generated-design defaults and revised:

| Default it could have fallen into | What the first pass had | What this plan does instead, and why |
|---|---|---|
| Cream, serif, terracotta | — | Cool drafting paper, a grotesque, cobalt: a technical drawing, his subject. |
| Near-black with one acid accent | A near-black dark theme | The dark theme is a blueprint blue, the same drawing printed as a cyanotype. |
| Broadsheet hairlines, zero radius | The old site's square corners and rules | Corners by hierarchy; hairlines only where they encode a row or a cell. |
| The SaaS card kit | Five identical rounded cards with shadows | No shadow; lab cards each carry their own glyph cut from the drawing; radius only on cards. |
| Tracked capitals over every heading | syntaqx's "CURRENTLY" eyebrows | Block names in sentence case in the wide face, only over blocks that are named in his content. Capitals only for the name. |
| A '→' after links, mono data labels | — | Words only; dates and captions in the wide face, mono for code alone. |
| A commit heatmap (the reference's) | A contributions grid | A decision log, from the ADRs: his judgment, from data he owns, not a second copy of git. |
| Teal on grey-green (the reference's and today's) | Grey-green paper | Cool white and cobalt: unmistakably different from today's site and not syntaqx's colours. |

## 10. For builders

- Colours only in `tokens.css`; no `style` attribute; no inline script beyond the theme script; fonts only through `scripts/fonts/build.sh --write`.
- Budgets the tests hold: eager JS 5,000 B gzip, CSS 15,000 B, preloaded fonts 70,000 B, first view 150,000 B. Today: Home 13,204 B CSS, preloaded fonts 48,244 B everywhere.
- Never edit `src/content/`: lay the words out anew, keep them.
- Replace a test that pins the old design with one for the new; never just delete it. Keep every invariant: CSP, budgets, axe in both themes, the phone project, links, review stamps, the firewall.
- In comments, avoid words Tailwind reads as utility classes (r-i-n-g, f-l-e-x, b-l-o-c-k, h-i-d-d-e-n, t-r-a-n-s-f-o-r-m and the like).
