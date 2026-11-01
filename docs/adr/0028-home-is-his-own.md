# ADR 0028: Home is his own: his words as the statement, his Raft cluster live beside them, what he builds with the labs as its evidence

Status: Proposed · 2026-11-01 · Deciders: Joseph Peterson · Supersedes in part [ADR 0027](0027-design-follows-josephs-references.md) (Home's composition) · The page's design: [docs/design/home.md](../design/home.md)

## Context

ADR 0027 shipped on 2026-10-31 (PR #58). Ten minutes later Joseph asked: "Why does it rip off other people". Side by side with syntaqx.com, the reference he had named, Home was that page's composition in other colours:

- the name in condensed capitals;
- three labelled bio blocks, his "Currently, Previously, Otherwise" renamed;
- an isometric architecture drawing beside them, with leader lines to labelled boxes and cylinders;
- a four-cell stats row, then an activity heatmap;
- cards and a dated writing list.

ADR 0027's review had checked that no word, colour or drawing was copied. It had not checked the composition, and a recognisable composition with its signature element is copying with new assets. Joseph's next words: "I want it to look amazing ... just you."

## Decision

A reference names the kind of site, never a layout to copy. Home keeps only what several of his references share and what is his:

- **Shared conventions:** an about-me first, one top bar with search and the theme, a light and a dark theme, a dated writing list.
- **His own:**
  - **The opening is his words, at the size of a statement.** The bio's first sentence is the statement. Each kind of system it names (queues, data pipelines, caches, clusters) is a link to the lab that runs one, underlined in that lab's colour. The rest of the opening follows at a lead's size, word for word. His name stands above it in Archivo Expanded, in its own case: Home sets nothing in capitals.
  - **One live thing: his Raft cluster.** It is the Raft Lab's opening run, drawn at build as SVG: five servers on a ring laid back in perspective, the leader lit, its heartbeats running out and their answers back, and each server's log beside it, as long on every server because they agree. It turns slowly once the page has painted, rises to face the reader as the opening scrolls away, holds still under reduced motion, and the top bar's button pauses it. Its caption links to the lab where it can be broken.
  - **What I build carries the labs as evidence.** It has a row for each of the bio's five things. A row whose words name a lab carries that lab's colour, its name, and one fact from its build (lib/lab-facts.ts).
  - **The record is one sentence, not a row of figures:** the repository's commits, decision records, tests, and the seeded runs every pull request plays, each counted at build from its source. It closes How I work.
  - **The address can be copied.** A mailto link opens nothing on a computer with no mail app set up, so Contact shows the address large, with a button that copies it.

Gone from Home:
- the condensed capital name (`.nameplate`, `--text-hero`);
- the bio blocks;
- the isometric system drawing (`components/iso/System.astro`, `lib/iso/system.ts`);
- the stats row and the activity calendar (`components/home/Stats.astro` and `Activity.astro`, the calendar in `lib/home.ts`);
- Home's lab cards (`components/home/LabCards.astro`).

The Lab index keeps its cards and their glyphs.

## Alternatives considered

- **Recolour ADR 0027's Home.** The composition is the copy. Recolouring repeats the mistake Joseph rejected twice on 2026-10-31, in reverse: the morning's round kept his old layout with new tokens, and this would keep another person's layout with new tokens.
- **Roll back to ADR 0025's Home.** Two-way and quick, but Joseph had found it "almost identical to what we started with", and it carries the faces and chrome ADR 0027 replaced.
- **A breakable lab in the opening.** A real simulation in the hero, crashed with a button. It is the most his, but it is a module on Home's first paint against a 5 KB eager budget, and a second copy of a lab's controls. The cluster shows the system; the lab is one press away. Revisit once the labs share a renderer small enough to load on intent.

## The architect's pass

### Why

A visitor deciding whether to hire or work with Joseph should see in seconds what he builds and that it is his. A layout borrowed from another engineer's site says the opposite.

### Data ownership

| Data | System of record | Writer | Readers | How it crosses |
|---|---|---|---|---|
| His words | `src/content/about.md` (stamped) | Joseph | Home, /about/ | the build; this ADR changes no word, only their layout |
| The cluster | the Raft Lab's opening run, `lib/raft/view.ts` | the lab's code | Home's picture, the Raft Lab | the build replays it; the picture cannot disagree with the lab |
| Each lab's fact | `lib/lab-facts.ts`, from each lab's runs | the labs' code | Home, the Lab index | the build |
| The record | git's history, `docs/adr/`, the test files, each lab's `SEEDS_IN_CI` | the repository | Home | counted at build; a source that cannot be read is left out, never guessed |
| The address | `lib/site.ts` | Joseph | every page | the build |

No datum gains a second owner. The record recomputes from git on every build: it is a projection of git's history, not a copy beside it.

### Prior art

Every part is built from what the site already had:
- the Raft simulation and its opening run;
- the facts module;
- the motion module and its pause button;
- the fonts pipeline.

The motion uses CSS scroll-driven animations and SVG drawn at build, with no library.

The copy button uses the asynchronous Clipboard API. Where the API refuses, it falls back to selecting the address.

## Consequences

- **Bytes:**
  - Home's CSS is smaller than 0027's (the drawing's rules are gone).
  - One small module copies the address. `test/scripts.test.ts` names it, so no other page may load it.
  - The preloaded faces are unchanged.
- **Tests:**
  - The checks that held 0027's Home were replaced with checks of this one: the opening, the cluster, What I build, the address, the fold, print, motion, the large-text and target-size checks.
  - Every invariant stands: the phone's steadiness checks, CSP, budgets, axe in both themes, links, review stamps, the firewall.
- **Build gotchas:**
  - The build's CSS minifier drops the standalone `translate` property.
  - It also folds animation longhands into a shorthand, which cannot hold a scroll timeline.
  - Home's stylesheet works around both, and says where.

## Door

Two-way in code: one page, one stylesheet, two components. A revert restores 0027's Home.

In public it is a first impression, and the third Home in two days. It changes next only on the evidence below.

## Revisit if

- **Joseph's first read is not "this is mine".** Then sit with him over the page and mark what to keep, part by part.
- **Fewer than 3 of 5 readers in a 7-second test** ([product.md](../product.md)) can name two of queues, caches, pipelines or consensus from the first screen.
- **Fewer than one Home visit in ten opens a lab** in the month after launch (Web Analytics).

## Patterns and further reading

- **Influence without imitation:** take the conventions a genre shares, never one work's signature. Austin Kleon, *Steal Like an Artist*, "Don't just steal the style, steal the thinking behind the style".
- **Derived data, one owner:** Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 11.
- **Scroll-driven animations:** Bramus Van Damme, [scroll-driven-animations.style](https://scroll-driven-animations.style/).
