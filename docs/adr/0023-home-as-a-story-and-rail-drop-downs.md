# ADR 0023: Home told as a story, with isometric pictures drawn at build; the rail's items drop down

Status: Proposed · 2026-10-29 · Deciders: Joseph Peterson · Amended by [ADR 0024](0024-home-led-by-the-work.md): the hero stands over the Route Lab's day, the cluster acts out an election in a chapter of its own, and the stack and the card pictures are gone · Amended by [ADR 0025](0025-signal-box-identity.md): the last isometric picture, the Raft cluster, is retired with `lib/iso.ts`, and "View all" carries no arrow

## Context

On 2026-10-29, after [ADR 0022](0022-rail-as-index-and-row-links.md) shipped, Joseph read the site again and asked for two things:

- "The side bar should hide the details of whats on that page until you click and then it drops down to show view all at the bottom or most recent desc." ADR 0022 listed every demo and the newest posts under their items, open, on every page.
- "Doesnt really feel like any of your research landed … Can you please overhaul the site to make it look more like the examples you looked up? Seems like most start with an about me that scrolls downward with some 3d/animations." He asked that the site advertise the architecture principles he understands and has applied, and the way he thinks.

He was right that the research had not landed. Read side by side at 1440 × 900 the same day:

| | syntaqx.com | brittanychiang.com | taniarascia.com | this site, Home |
|---|---|---|---|---|
| First screen says who, in the first person | "I lead software engineering orgs, own architecture…" | "Hi there! I'm Brittany…" | "Hey, I'm Tania!" and a timeline | the name, the title, "US · remote", buttons |
| A picture of the work | an isometric drawing of a system | none | an illustration | the contour background only |
| Below the first screen | a row of numbers, writing rows, tool cards | About, Experience and Projects scroll past a still column | latest posts | two cards, then "Writing" with two links and no post |

Home said nothing about how Joseph works. The bio that does, `src/content/about.md`, which Joseph cleared on 2026-10-29, lived only on `/about/`.

## Decision

### The rail's items drop down

**An item that holds pages is a disclosure**, closed until pressed. Pressed, it drops down to its pages, newest first where they have dates, then "View all demos →" or "View all posts →", its index.

- **It is a `<details>`**, so it needs no script. Its `<summary>` is announced as a button that says whether it is expanded, and Enter or Space opens it.
- **The items share one name** (`name="rail"`), so opening one closes the other.
- **It stands open on a page it lists**, with that page marked. So a visitor who follows a demo from the drop-down still sees where they are.
- **The section's bar** marks the item while the visitor is inside its section, until a leaf shows the bar itself.
- **It opens at once.** Only the chevron turns, and that instantly too, as keyboard-driven UI does here.
- **Below 80rem nothing changes**: each item is its plain link in the row across the top.

**Writing lists its newest posts first.** Posts carry a `published` day.

**Lab lists its demos in the lab's order.** A demo has no date: adding one means editing each lab entry, which needs Joseph's review stamp, and the Route Lab's entry still carries the placeholder stamp. With two demos, the lab's order (Raft, then the bakery) is also newest first. See Revisit if.

### Home tells who Joseph is, top to bottom

| Row | What | From |
|---|---|---|
| Intro | the name; the title and location; **the bio's opening sentence**; Email, About me →, Work ↓, LinkedIn ↗. Beside it from 64rem, under it on a phone, **the Raft Lab's cluster in isometric**, captioned with a link to the lab | `about.md`, `profile.json`, `lib/iso.ts` |
| How I work | **the bio's five principles**, numbered, each bold sentence a title. Its words "Route Lab" and "Raft Lab" link to those demos. From 64rem the section's title and a stack of five slabs stand still in columns 1 to 4 while the principles scroll by | `about.md` |
| Selected work | a card per demo, now with an isometric picture of it under its tag; projects once checked | lab entries, `profile.json` |
| Writing | the newest posts, each with its date and kind. The teardown is listed here, not as a card | posts' front matter |
| What I'm working toward | the bio's closing paragraph, then Email and LinkedIn | `about.md` |

### The bio stays the one owner of Joseph's words

- **Home reads `about.md`**, the file `/about/` renders whole, through `aboutParts` (`lib/about.ts`). It parses paragraphs, `###` headings and lists whose items open with a bold sentence. Nothing on Home is a copy of the bio.
- **The parser fails closed.** Markup Home would print as characters, such as a link, code or emphasis, stops the build rather than reach the page. A change to the bio changes both pages, or stops the build.
- **The hero's sentence is the bio's opening.** Content.md held the hero's sentence until Joseph cleared one, and he cleared this one with the bio.

### The pictures are isometric SVG, computed at build

- **The geometry.** `lib/iso.ts` projects a small world, x and y on the floor and z up, each floor axis 30° off the horizontal. It writes polygons: the Raft cluster (five servers, the leader's roof in the accent, each election timer part full, each log's cells, a hollow uncommitted entry on the leader), a stack of slabs, and the bakery with its isochrone bands and one van's round.
- **No script draws a line.** Faces take the page's own surfaces, through `--face-top`, `--face-left` and `--face-right`, so both themes, print and forced colors follow.
- **The pictures are hidden from screen readers.** What they show is in the words beside them.
- **They do not print.**

**What moves, and when.** Every movement is CSS, on transform and opacity, inside `prefers-reduced-motion: no-preference`:

- **The hero's heartbeats** travel from the leader to its four followers, and its roof ripples, every 2.4 s. They run only while Home's living ground runs ([ADR 0021](0021-rail-and-living-ground.md)), and its pause button pauses both: one button for every motion on the first screen (SC 2.2.2).
- **A card's picture moves only while its card is pointed at or focused**: heartbeats on the Raft card, the van driving its round on the bakery's.
- **Scrolling moves the rest, and only scrolling.**
  - The hero's picture tilts back as it scrolls away, while its servers lift in turn.
  - Each slab of the stack settles onto the one below as its principle arrives, on that principle's own view timeline.

**How a moving part knows its path.** A page may hold no style attribute and no style element but the Fonts API's (`test/csp.test.ts`), so keyframes cannot be written per path. Instead the SVG `transform` of the group around a mover maps one unit along x to its whole path, and the stylesheet's shared keyframes move it one unit (`frame()` in `lib/iso.ts`). A dart or a van is drawn in that frame, divided by the path's length along x, so it keeps its size on the page.

**The geometry and the stylesheet stay in step through a test.** The van's six legs, the stack's most of eight slabs and the 2.4 s beat are numbers the stylesheet also holds. `test/iso.test.ts` reads `global.css` and fails if the two disagree.

### Two things the reference sites do that Home does not

- **No drawing of this site's own architecture**, which is what syntaqx's hero is. On 2026-10-24 Joseph ruled that nothing on a page shows how the site is built ([design-system.md](../design-system.md#nothing-on-the-page-describes-the-site)). The picture is the Raft Lab instead: his work, and it opens the demo.
- **No row of numbers.** Content.md allows a figure only where a reader can check it. The strongest figures (decision records, tests) live in the repository, which the site does not link until the GitHub profile passes its readiness check (content.md, "Repo readiness checklist"). The figures the labs state, 3,000 seeded runs and 4,032 drive times, are in the principles' words already.

## Alternatives considered

| Option | Trades | Door |
|---|---|---|
| **A. Isometric SVG computed at build, moved by CSS (chosen)** | Zero script, 0.4 to 1.4 KB gzip of markup per picture, crisp at any size. Both themes, print and forced colors work, and it is readable as code. The "3D" is drawn, not rendered: no free camera, no orbit. | Two-way |
| B. A three.js scene, as the Route Lab's cube ([ADR 0019](0019-space-time-cube-in-webgl.md)) | A real camera, light and orbit. But about 150 KB more on a page whose whole budget is 150 KB, and a second WebGL context beside the living ground's, for a picture. | Two-way |
| C. CSS 3D transforms on HTML boxes | Real perspective, no library. But a box is six elements, each face is shaded by hand, and print and forced colors need a rule each. | Two-way |
| D. Lottie or a video loop | Designed motion. But it is bytes, not data: it does not take the theme, and nothing ties it to the lab it shows. | Two-way |
| E. An embedded 3D tool's scene (Spline and the like) | Fast to make. But it loads from another origin, which the page's policy refuses, at hundreds of kB or more. | Two-way |

For the rail:

| Option | Trades |
|---|---|
| **`<details>` disclosures (chosen)** | Native: no script, Enter and Space, expanded state announced, exclusive through `name`. |
| ARIA disclosure buttons with a script (the WAI-ARIA APG "disclosure navigation" example) | The same behavior, with a script to keep `aria-expanded` and keys in step. |
| Flyouts on hover | Nothing on touch. A hover-only reveal must also stay put and be dismissable (SC 1.4.13). |

## Prior art

- The reference sites, read on 2026-10-29: **syntaqx.com**, **brittanychiang.com**, **taniarascia.com** (the table above).
- **Isometric system drawings**: syntaqx's hero; the cloud vendors' isometric architecture icon sets; and the long-standing technical drawing convention of the **exploded view**, which the stack borrows: parts drawn apart along one axis, settling into place.
- **Disclosure**: the WAI-ARIA Authoring Practices "Disclosure (Show/Hide)" pattern; MDN on `<details name>` for exclusive accordions.
- **Scroll-driven animation** ("scrollytelling"): the CSS Scroll-driven Animations spec's view timelines and `timeline-scope`.

## Consequences

- **Bytes, gzip -9, against production on 2026-10-29.**
  - Home's HTML: 6,680 → 10,046 B (the three pictures, the principles, the closing).
  - The stylesheet: 8,742 → 10,362 B.
  - Every other page: about +130 to +185 B, for the drop-downs.
  - No new script.
  - Within budget (`test/budgets.test.ts`, Lighthouse CI).
- **Tab order.** Closed items are one stop each. On a demo, Lab stands open: every demo and "View all demos" come between Lab and Writing (`e2e/living-ground.spec.ts`).
- **The motion rule "one moving thing on screen at a time" is amended.** On Home's first screen the living ground and the cluster's heartbeats are one scene under one button. Everything else that moves, moves with the scroll or the pointer.
- **No post is a card.** `FEATURED_POSTS` is empty: a post is listed under Writing, on Home and on `/about/`, with its date. The machinery stays, tested, for a post that earns a card.
- **The check that no card describes the site** (`test/readouts.test.ts`) looks for a card titled "This site", not for the words. The bio's opening says "This site is that work", Joseph's own sentence.
- **Tests.**
  - `test/iso.test.ts`: the projection with known answers, each frame ending where it should, the viewBox, and the stylesheet in step.
  - `test/about.test.ts`: `aboutParts` on the real bio and on known answers, failing closed, and `withLinks`.
  - `e2e/index.spec.ts`: the drop-downs, closed on Home, open on a demo, exclusive.
  - `e2e/motion.spec.ts`: names every new moving part.

## Door

Two-way. Every part is markup and CSS the build writes:

- the pictures are three components;
- the story is one page;
- the drop-downs are one `<details>` per item.

Going back to ADR 0022's open lists is a revert of `Header.astro` and a block of CSS.

## Revisit if

- **The lab reaches about five demos**, and "newest first" starts to matter. Then give the lab schema a `published` day, which re-stamps each entry with Joseph's read, and sort by it.
- **The bio grows past eight principles**, the most the stack draws. The build stops there by design.
- **Field data on Home's CLS or INP worsens** after this, or a reader of the Raft card says the heartbeats distract. Then the heartbeats stop with the ground and run only on hover, as the cards' do.
- **The GitHub profile passes its readiness check, or the decision records render on the site** (`/colophon/decisions/`). Then a row of checkable numbers, decision records and test counts, earns its place.

## Patterns and further reading

- **One owner, many views**: the bio, rendered whole on `/about/` and in parts on Home. Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 11's "derived data", applied at build time.
- **Fitness functions**: tests that hold an architectural property, here the geometry and the stylesheet agreeing. Neal Ford, Rebecca Parsons and Patrick Kua, *Building Evolutionary Architectures*, chapter 2.
- **Fail closed**: the bio's parser refuses markup it does not know rather than print it. Saltzer and Schroeder's "fail-safe defaults", in "The Protection of Information in Computer Systems" (1975).
