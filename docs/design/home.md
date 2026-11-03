# Home

The page's design, as built ([ADR 0028](../adr/0028-home-is-his-own.md)). The palette, the faces, the top bar, the footer and the frame are [overhaul.md](overhaul.md)'s. Its Home section is superseded by this one.

## Who it is for

Someone deciding in under a minute whether to hire or work with Joseph. Home's job is to say, in their words, what they build, and to show it working.

## The opening

On a phone, the opening is one column:

1. The role, in the wide face, muted.
2. The name, in Archivo Expanded, in its own case (`--text-name`, 32 to 72 px).
3. The statement: the bio's first sentence and one of Home's own, "Here are a few things you can break." (`--text-statement`, 22 to 30 px), with no link in it since 2026-11-03 ([ADR 0031](../adr/0031-about-leads-with-what-joseph-builds.md)).
4. The rest of the bio's opening, at a lead's size, muted.
5. The checked profiles' buttons, LinkedIn leading as the primary and then GitHub, each one width at every screen width, side by side down to 320 px, and stacked as two equal bars only at a larger text size. They end inside the first screen Safari shows on an iPhone from the 13 up, 390×664 and 393×659 (`e2e/fold.spec.ts`), and past it on a 13 mini (375×629) and at 320×568, where the opening's words alone take the room.

From 64rem the words take a little over half the row, and the cluster stands beside them. The name stands in two lines there and one on a phone.

## The cluster

The Raft Lab's opening run, drawn at build by `components/home/Orbit.astro`, from the geometry `lib/orbit.ts` shares with Home's link preview (`lib/og-art.ts`):

- five servers on a ring, the leader lit, a glow and a halo around it;
- a wire from the leader to each follower;
- the log beside each server, a bead an entry.

The SVG lies back in perspective, `rotateX(58deg)`, in a stage that keeps a 16 to 10 box from the first paint. Laid back, the ring's near side draws larger than its column, so its picture stands a little above the stage's middle and may reach 12 px past the column's sides, into a margin with no words in it; a clip just outside that stops the plane's turning corners from scrolling the page sideways, and no server or bead reaches it at any point of the turn (`e2e/home.spec.ts`, since 2026-11-02, when the clip on the stage's own edges cut the beads for half of every turn). Once the motion module has marked the page:

- the inner group turns once in 90 s (the SVG itself never moves, so the phone's steadiness checks see a still box);
- every 2.4 s a heartbeat runs out along each wire and its answer runs back;
- the halo breathes.

As the opening scrolls away, the plane rises to `rotateX(28deg)`, tied to the scroll. Under reduced motion nothing runs, and the top bar's button pauses everything. The caption names the leader and its term, and links to the Raft Lab.

## Things I built that you can try

Each of the bio's things is a row between hairlines, in the bio's order:

- its lead in the wide face, after a dot in its lab's colour;
- its words;
- the lab's name and one fact from its build (`lib/lab-facts.ts`), under a 2 px rule in the lab's colour.

From 64rem the lead, the words and the fact stand in three columns. "Try all the labs" opens the index: no page says how many there are, since there'll be more (`test/no-lab-count.test.ts`).

## The biggest thing

The bio's The biggest thing I've built, word for word, stands above The last thing I built, whose last sentence points back to it: "The CRM work above is where I do that." Until the review of 2026-11-03 Home printed that sentence with nothing above it, and never said what real users rely on. `test/about.test.ts` holds the section, its words and its place.

## The record

The last thing I built, the bio's prose in the place How I work held until 2026-11-03, ends, under a hairline, with one sentence. It counts the decision records, the tests and the seeded runs on every pull request, each at build from its source. It is a sentence, not a row of figures: the stats row and the heatmap were the reference's signature. It's where the site says "decision records (ADRs)", once, for the tech lead who looks for the term, in plain words. It says "tests written" because it counts declarations: a loop that runs one test across every page counts once, so CI's total is about nine times larger, and a reader who opens CI should find the words true.

## Contact

`components/home/Contact.astro`, on Home and `/about/`, closes the page: the bio's last heading at a section's size, its words at a lead's, and LinkedIn to press, in the primary button. LinkedIn is how people reach Joseph, and no page asks a reader to email ([ADR 0031](../adr/0031-about-leads-with-what-joseph-builds.md)). Until 2026-11-03 this was the address at a title's size, with a button that copied it. A build with no bio says "Contact" over the button.

## Type

Home speaks in the wide face: the name, the section titles, the leads and the writing's titles. The wide face counts as a label to `test/tells.test.ts`, so none of it is tracked. The condensed display face does not appear on Home.

## For builders

- Colours only from `tokens.css`. Motion only under `prefers-reduced-motion: no-preference`, run by `data-motion`.
- The build's CSS minifier drops the standalone `translate` property: centre with a transform.
- The same minifier folds animation longhands into a shorthand that cannot hold a timeline: give a scroll-driven animation its name in a rule of its own.
- Never edit `src/content/`. Lay the words out anew, and keep them.
