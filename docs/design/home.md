# Home

The page's design, as built ([ADR 0028](../adr/0028-home-is-his-own.md)). The palette, the faces, the top bar, the footer and the frame are [overhaul.md](overhaul.md)'s. Its Home section is superseded by this one.

## Who it is for

Someone deciding in under a minute whether to hire or work with Joseph. Home's job is to say, in his words, what he builds, and to show it working.

## The opening

On a phone, the opening is one column:
1. The role, in the wide face, muted.
2. The name, in Archivo Expanded, in its own case (`--text-name`, 32 to 72 px).
3. The statement: the bio's first sentence (`--text-statement`, 22 to 30 px). Its kinds of system (queues, data pipelines, caches, clusters) are links to their labs, underlined in each lab's colour.
4. The rest of the bio's opening, at a lead's size, muted.
5. The two buttons, Email and LinkedIn, each one width at every screen width.

From 64rem the words take a little over half the row, and the cluster stands beside them. The name stands in two lines there and one on a phone.

## The cluster

The Raft Lab's opening run, drawn at build by `components/home/Orbit.astro`:
- five servers on a ring, the leader lit, a glow and a halo around it;
- a wire from the leader to each follower;
- the log beside each server, a bead an entry.

The SVG lies back in perspective, `rotateX(58deg)`, in a stage that keeps a 16 to 10 box from the first paint and clips the turning corners. Once the motion module has marked the page:
- the inner group turns once in 90 s (the SVG itself never moves, so the phone's steadiness checks see a still box);
- every 2.4 s a heartbeat runs out along each wire and its answer runs back;
- the halo breathes.

As the opening scrolls away, the plane rises to `rotateX(28deg)`, tied to the scroll. Under reduced motion nothing runs, and the top bar's button pauses everything. The caption names the leader and its term, and links to the Raft Lab.

## What I build

Each of the bio's five things is a row between hairlines:
- its lead in the wide face, after a dot in its lab's colour;
- its words;
- the lab's name and one fact from its build (`lib/lab-facts.ts`), under a 2 px rule in the lab's colour.

From 64rem the lead, the words and the fact stand in three columns. A row with no lab, such as the agents line, which points to the essay, has the accent's dot and no fact. "All five labs" opens the index.

## The record

How I work ends, under a hairline, with one sentence. It counts the commits in the repository, the decision records, the tests and the seeded runs on every pull request, each at build from its source. It is a sentence, not a row of figures: the stats row and the heatmap were the reference's signature.

## Contact

`components/home/Contact.astro` shows the address at a title's size in the wide face:
- a section's size below 64rem, and a headline's below 27rem;
- it breaks only after its @;
- its underline is unbroken under the letters that hang below the line.

Under the address, a button copies it (`scripts/copy.js`). Where the clipboard refuses, the button selects the address instead, and either way it says what it did without changing width. LinkedIn follows.

## Type

Home speaks in the wide face: the name, the section titles, the leads, the writing's titles and the address. The wide face counts as a label to `test/tells.test.ts`, so none of it is tracked. The condensed display face does not appear on Home.

## For builders

- Colours only from `tokens.css`. Motion only under `prefers-reduced-motion: no-preference`, run by `data-motion`.
- The build's CSS minifier drops the standalone `translate` property: centre with a transform.
- The same minifier folds animation longhands into a shorthand that cannot hold a timeline: give a scroll-driven animation its name in a rule of its own.
- Never edit `src/content/`. Lay the words out anew, and keep them.
