# ADR 0026: The Queue, Cache and Backfill Labs are deterministic simulations in the browser, on one shared kernel

Status: Proposed · 2026-10-31 · Deciders: Joseph Peterson

## Context

On 2026-10-30 Joseph asked for a site that shows what he can do for others. The Lab showed routing (the Route Lab, [ADR 0016](0016-route-lab-in-the-browser.md)) and consensus (the Raft Lab, [ADR 0020](0020-raft-lab-deterministic-simulation.md)). Three systems most back ends rely on, a queue, a cache and a scheduled pipeline, appeared nowhere. Three labs close that gap, one each, set in the bakery the Route Lab already plans deliveries for: its online orders wait in a queue, its menu page sits in a cache, and its daily order report is a scheduled job that a backfill runs for a week.

The need is the lab's own ([lab.md](../lab.md#why-a-lab)): inputs the visitor chooses, and proof that the system runs. Each lesson here is an operator's decision and what it costs when it is wrong:

- **Queue.** When a worker acknowledges an order, and whether it keeps an idempotency key, decide whether a crash loses the order, prints it twice, or neither.
- **Cache.** When a hot entry expires, its readers all go to the database at once. Coalescing, serving stale, early refresh and jitter each take a different bite out of that stampede.
- **Backfill.** A job that runs once per day of data must write each day idempotently, because retries, reruns and backfills run a day more than once.

Three constraints shaped the answer, as they shaped the Raft Lab's:

- **No backend.** The lab platform ([ADR 0009](0009-lab-worker-same-origin.md)) is Phase 4 and not built. A static page costs $0 on the Workers Free plan at any traffic, with no quota and no abuse surface ([ADR 0008](0008-workers-free-with-guardrails.md); [lab.md](../lab.md#route-lab-built-2026-10-25)).
- **Reproducible by seed.** Three things need a run that replays exactly: a page that opens on a picture the build drew and takes over at its moment, a link that reopens a visitor's run, and a CI sweep that searches thousands of seeds for bugs.
- **Small.** Every page but the Route Lab's keeps its first view, with what it loads, within 150,000 B. The Raft Lab's app has a budget of 8,000 B.

ADR 0020 set the pattern: a model of the system in TypeScript, run in virtual time from one seeded random stream, checked after every event, and swept over seeded runs in CI with broken variants the sweep must catch. This record applies it three more times, and decides what the labs share and what each model leaves out.

## Decision

**The Queue, Cache and Backfill Labs each run a model written here, in TypeScript, in virtual time, in the visitor's browser, on one kernel they share (`src/lib/sim/`). Their properties are checked after every event and swept over seeded runs in CI. The pages are `/lab/queue/`, `/lab/cache/` and `/lab/backfill/`.**

### The kernel: one seeded stream, an agenda, virtual time

- **One stream per run** (`random.ts`): mulberry32, seeded from the run's seed. Every draw a run makes, an arrival, a service time, a fetch, a failure, comes from it. A core reads no clock and never calls `Math.random`.
- **The agenda** (`agenda.ts`): a binary heap of pending events, ordered by virtual time and then by the order they were scheduled, so events at one moment always run in the same order.
- **Next-event time advance.** The clock jumps from one event to the next: milliseconds in the Queue and Cache Labs, whole minutes in the Backfill Lab. A page moves a run by asking it to run to a time, frame by frame.
- **What each lab adds** under `src/lib/<slug>/`: its model (`sim.ts`, with `core.ts` for its rules), its checker (`check.ts`) and what its page says (`view.ts`). The Raft Lab keeps its own copy of the generator, so its pinned runs never move.

**A replay is the run: deterministic lockstep.** A visitor's press is recorded with its virtual time, and `replay(config, actions, until)` rebuilds the run event for event. That holds only if an action lands where its replay will put it, and if no event runs late. The cores' reviews found both rules broken. A fuzz of 2,000 Backfill runs replayed 1,988 of them differently, and capped frames froze 20 of 20 of the Cache Lab's morning runs on a false conservation break (the two cores' review fixes, fb8be60 and 6f65d2f). The Raft Lab had both bugs too (8c36fbe). Each core now keeps the rule its own way:

| Core | How an action lands where its replay puts it |
|---|---|
| Raft, Queue | every action first runs the events still due at its moment (`catchUp`) |
| Cache | its run loop stops only between two moments, and its page never steps one event alone |
| Backfill | each action records how many events had run before it, and replay steps to that count |

In all four, a frame cut short by its event limit leaves the clock at the last event it ran.

### Properties, conservation and the sweeps

- **Three properties per lab**, named on the page, each checked at every event that could break it. Unlike the Raft Lab's, a broken property here is the lesson, not a bug: the run goes on, and the page counts each break and names the first.
- **Conservation is the bug detector.** Nothing appears or vanishes: every order is in exactly one place, every read ends once, every row in the report came from a write. The Queue Lab also audits each order against its own record every 250 ms. Only a bug in the model can break these, so a break freezes the run.
- **The sweeps** run in CI with the unit tests, which assert that each case in the last column breaks within the sweep. Some of those tests stop at the first seed that catches their case, so the totals below were counted over every seed, on 2026-10-31.

| Lab | Seeds | Each run | Holds in every run | Must break |
|---|---|---|---|---|
| Queue | 2,000 | 50 virtual seconds from the safe configuration (acknowledge after the work, key on): crashes, restarts, slow spells, prefetch and pool changes. Orders stop at 20 s and the pool grows to five | conservation; no order lost or printed twice; the queue drains within 30 s; a count rebuilt from each order's record agrees | acknowledging before the work loses an order in all 2,000 runs, and no key prints one twice in 1,168; three broken brokers or workers break a property in 2,000, 1,168 and 2,000 |
| Cache | 600, then 600 more with coalescing on throughout | 15 virtual seconds: loads, switches and placements changed mid-run, flushes, lost nodes, writes | conservation; each switch keeps its promise while it stays on, such as coalescing: no node fetches a page twice at once. In the first 600 only the 218 runs that start with coalescing on and never flip it hold it to that, so the second 600 keep it on, and it holds in all of them | five broken caches are caught in 31, 600, 201, 437 and 528 runs, each run with the setting it breaks forced on where it has one |
| Backfill | 3,000, in six passes | a week from the switch: random failures, late files, clears, run limits | with overwrite and the run's own day: conservation, all three properties, every run finished, no check failed | append breaks the totals in 2,986 weeks, and writing to the clock's day in all 3,000; three broken schedulers in 3,000, 2,172 and 1,709 |
| Raft ([ADR 0020](0020-raft-lab-deterministic-simulation.md)) | 3,000 | 8 virtual seconds of faults, then the network heals | the five safety properties; a write commits within 2.75 s of healing | two broken servers, in 774 and 4 runs (ADR 0020's postscript) |

On a laptop on 2026-10-31, with the labs' test files running side by side, the Queue Lab's sweep took 1.3 s, the Cache Lab's two passes 4.0 s, the Backfill Lab's six passes 4.0 s and the Raft Lab's 1.4 s.

### The page contract

Each of the three pages has the Raft Lab's parts, plus a history strip the Raft Lab lacks, so a visitor who has used one lab can use the next:

- **Parts.** A head with the title and its lead. A desk with the picture, its caption (the run's summary), the three properties, the history strip, the event log (`role="log"`) and a status line (`role="status"`). Then the write-up, and "How it is built", whose figures, such as the seeds swept, the page imports from the core instead of typing them.
- **Controls.** Run, which reads Pause while a run plays; Next event, which runs everything due at the next moment; Start over; a speed; then the lab's own settings and actions. A run opens paused and moves only between Run and Pause (SC 2.2.2). A hidden tab pauses it, and under reduced motion it moves in still steps, half a second of the chosen speed twice a second, so the speed still matters. Next event says where the run stands when the log has nothing to tell.
- **Without JavaScript** the page is the opening's picture, drawn at build by the same core. The app loads on intent and replays the opening to take over at the picture's moment: 4.0 s and 143 events into the Queue Lab's run, 5.0 s and 1,704 events into the Cache Lab's, and 02:10, 44 events after the switch, in the Backfill Lab's.
- **Start over keeps the seed and the visitor's settings**, so each thing to try is a comparison: one setting changed, on the same seed. The Raft Lab's Start over moves to the next seed instead. The Cache Lab's replays from 2.5 s, half a second before the menu expires, so the stampede plays live.
- **A link names a run** (`lib/sim/link.ts`): `#seed-N`, then `&name=value` for each setting that differs from the opening, in the order the lab declares them, such as `#seed-7&coalesce=on&stale=on`.
  - Start over writes it with `history.replaceState`, so it adds no history entry.
  - A page loaded with a link, or a link followed on the page, opens that run paused at the opening's moment.
  - Reading is tolerant: a name the lab does not have, or a value its setting cannot take, is dropped, and the setting keeps the opening's value.
  - A link names how a run starts, never the presses made during it.

### Modelling decisions

Each of these changes what a visitor sees, and each is recorded in a comment where the code makes it.

**Queue** (`src/lib/queue/`)

- **Three retries, four tries.** Dead-lettering retries a failing order after 200, 400 and 800 ms, and sets it aside after the fourth failure (`BACKOFF`). Dead-lettering after the third failure, the other reading, would never use the 800 ms wait. An order's tries so far count when the handling changes, as a broker's count of deliveries does: a poison order that has looped under requeue goes to the dead-letter queue at its next failure, with no wait, and the switch's log line names it.
- **Lowering the prefetch takes back nothing**, as AMQP's `basic.qos` does not: a worker keeps the orders it holds, and is sent no more until it holds fewer than the new prefetch. The log line says how many each such worker still holds.
- **Switching to acknowledge on delivery lets go at once of what the workers hold.** The switch applies to every order the broker has sent to a worker that is up, whether still on its way or in the worker's window, so a crash right after it loses what that worker held, as the entry's second try says (`setAck`). As first built, the switch applied from the next delivery, and the page's review found that a crash right after it lost nothing. Switching back applies from the next delivery, since an acknowledgement cannot be taken back. The other way, a switch that took effect only through Start over, was rejected: the entry says switch, then crash.
- **A 10 to 40 ms gap between a ticket and its acknowledgement** (`WRAP_UP`), inside the service time. A crash in it is the one that prints an order twice.
- **Draining depends on capacity**, not on the acknowledgement or the key. With the pool it had when orders stopped, the queue missed its 30 s in 53 of the 2,000 seeds, every one a rush, so the sweep grows the pool to five, as an operator would (`test/queue.test.ts`; counted on 2026-10-31, with the sweep's faults going on for all 50 s. The 165 first recorded here came from an older schedule, whose faults stopped with the orders).
- **Opening seed 28.** Under seed 7, worker 2 is still working at 2.4 s, so its order would print once. 28 is the first seed from 7 whose worker 2 is then between order 18's ticket, printed at 2,371 ms, and its acknowledgement.

**Cache** (`src/lib/cache/`)

- **The menu's fetch takes 420 ms, and every other page's 35 ms.** At 35 ms, the menu's readers would miss for only 35 ms after each expiry: two or three fetches at 300 reads a second, which a pool of 8 connections absorbs unseen. Over 60 seeds at a busy hour, none made 20 fetches at once or timed a reader out. At 420 ms, over the same 60 seeds, the expiry made 20 or more fetches at once in 35 and timed readers out in 52, and in each of 20 one-minute runs the line emptied before the next expiry (`DATABASE` in `core.ts`). The menu gathers every item on sale, so it is both the most read page and the slowest to rebuild: the case the XFetch paper is about.
- **Coalescing is per node.** Misses for one page on one node wait on one fetch. A page that moves to another node mid-fetch is fetched again there, and with no node up nothing coalesces. So "one fetch of a page at a time" can break with coalescing on, and says why when it does; the sweep holds coalescing to its promise on each node. It stands in for the leases of Nishtala et al.
- **The pool drops a queued fetch whose readers have all left.** A fetch still waiting for a connection when its last reader gives up leaves the line unstarted, as a pool drops a caller who stopped waiting. A fetch already running finishes and stores the page (`cancel` in `sim.ts`).
  - Kept in line, the morning rush with nothing on never recovered: at seed 1 the line held 4,309 fetches after 30 s and 50,110 after two minutes, and 4% of reads hit. Dropped, the line never passed 314 fetches over 40 one-minute seeds, and emptied in the second half of every run (`core.ts`).
  - So the lab shows expiries that come back in waves, and not a metastable failure, which needs abandoned work to keep running. The waves do not die out: the fetches that refill a page store it again as each answers, so pages fetched together expire together 8 s after their last answer, and with nothing on the overload comes back about every 10 s. After a flush at the morning rush, seed 7's line peaked at about 280, 120, 80, 180, 60, 240 and 190 fetches over 70 s; over seeds 1 to 40, every run had seven waves, and in none did each wave come out smaller than the one before. With jitter and early refresh on before the flush, the line stayed at 13 or fewer after the first wave in all 40 (counted 2026-10-31). A prototype that kept it running did collapse and stay collapsed. But then jitter and early refresh stopped helping, the calm load never recovered, and the busy one collapsed in 2 of 40 seeds, which broke the entry's other tries (the page's review fix, 49da78c).
  - The entry says waves. A retry storm, the metastable failure proper, is left for a decision of its own.
- **A fetch reads the database as it answers**, so the race that leases fix, a stale value stored after a delete, is not modelled. With invalidation on, the freshness property can break only through a test-only fault.
- **Opening seed 7, the Raft Lab's**, with the menu's expiry pinned at 3.0 s; the seed's own draw would put it at 94 ms. Every page still draws its expiry, so the rest of the stream stays where it was.

**Backfill** (`src/lib/backfill/`)

- **A check that finds the totals apart fails, and is not retried** (2123ebe). A retry would read the same rows and find the same totals, since only a load changes them, and the day's run fails with its check. Retries stay for transient faults: an extract or a load fails on its own 8% of the time and gets three attempts, 5 and then 10 minutes apart (`core.ts`). Before, the check succeeded as a task while the board drew it as a cross.
- **A failed load has written a seeded 20 to 80% of its rows**, which append leaves behind. That is how 96 of Wednesday's rows count twice.
- **A clear reruns a day from its extract**, and a load the clear stops has written nothing: a simplification, noted where a load commits.
- **Opening seed 9.** Under seed 7 Thursday's load also fails on its own, and under 8 Saturday's, so two days come out wrong. 9 is the first seed after 7 whose only failure is Wednesday's.

**The rule behind the opening seeds.** Start from 7, the Raft Lab's seed. When its run does not tell the entry's story, take the first seed after 7 that does, say why in the view's comment, and pin the story's numbers in a test. A stated rule picks the seed, not a search for the best-looking run.

### Budgets

Measured on 2026-10-31, gzip -9 with zlib, as `test/budgets.test.ts` measures, on the labs' review fixes merged with [ADR 0025](0025-signal-box-identity.md)'s signal box; `test/support/labs.ts` holds the lazy budgets and records the same figures. The merge moved each lab's app by 13 to 44 B and no budget.

| | Raft Lab | Queue Lab | Cache Lab | Backfill Lab | Budget |
|---|---|---|---|---|---|
| Lazy JavaScript: every chunk its module can load | 7,343 B | 12,474 B | 11,166 B | 11,572 B | 8,000 B for the Raft Lab (ADR 0020); proposed here, each lab's measure rounded up to the next 500 B: 12,500 B for the Queue Lab, 11,500 B for the Cache Lab, 12,000 B for the Backfill Lab |
| of which its app | 7,016 B | 11,555 B | 10,247 B | 10,653 B | |
| of which the link's chunk, shared | 327 B | 327 B | 327 B | 327 B | |
| of which `lib/sim`'s other chunk, shared | | 592 B | 592 B | 592 B | |
| Eager JavaScript on its page | 3,714 B | 3,726 B | 3,724 B | 3,728 B | 5,000 B |
| CSS on its page | 10,948 B | 11,076 B | 11,448 B | 11,434 B | 15,000 B |
| First view with the app: the page, which holds its inline code, the stylesheets it links, declared fonts, eager script files and the lazy chunks | 81,672 B | 88,539 B | 87,390 B | 88,824 B | 150,000 B |

- **`lib/sim`'s two chunks.** The link, `lib/sim/link.ts`, is a chunk of its own, which all four apps import, and the agenda and the stream a second, which the three new apps import; each lab's budget counts what it loads in full: a visitor who opens one lab downloads it with that lab. Until the Raft Lab's link joined it, one chunk held all three, 841 B; the split costs each new lab 78 B.
- **The first view counts a page's inline code once.** Its inline scripts and styles are part of the page's own bytes. Until 2026-10-31 the measure added them again beside the page, 1,145 B on each lab page; each figure was an upper bound.
- **Why not ADR 0020's 8,000 B.** The three models are larger than the Raft Lab's. The Backfill Lab's simulator, checker and model alone are about 6,200 B, and the Cache Lab's app is about 7,700 B with every string emptied. Meeting 8,000 B would mean cutting the pages' words and views, which carry the lessons.
- **Why each budget is its measure rounded up to the next 500 B.** The branches set the Cache and Backfill Labs at 11,000 B. The shared link took them to 11,005 and 11,319 B, and both were raised to 12,000 B before a measure needed it, with no record. A budget a little above its measure makes the next growth a decision. The Queue Lab's 12,500 B is the same rule: the link took it to 12,048 B, and the note under its loads, which says how many workers are up, to 12,430 B, and the merge with the signal box to 12,474 B. Its app carries about 118 B of test-only fault branches and 111 B of pool resizing that no control on its page reaches. Keeping 12,000 B would mean dropping those branches behind a build-time constant, which ties the core to the bundler. Recommended: accept these budgets now, and take the branches out the next time any lab needs room (Revisit if).

## Who owns what

| Data | System of record | Read by | How it crosses |
|---|---|---|---|
| A run: its seed, its settings, the presses made in it | the visitor's tab, in memory; nothing is stored or sent | its page's app | the seed and the settings as a link in the address bar; presses never leave the tab |
| The opening's picture | the build, from the lab's own core (`openingRun()`) | a visitor without JavaScript | static HTML. The app never reads the picture: it replays the same seed and actions, so the two agree by construction |
| The lab's words | its entry, `src/content/lab/<slug>.md`, once Joseph has read it | the page, the Lab index, the command menu | the build; on a pull request that changes the entry, CI's review stamp refuses the placeholder |
| Figures a page states about its model: the seeds swept, the events at the opening | the core (`SEEDS_IN_CI`, `openingRun()`) | "How it is built" | imported at build, never typed |
| Lazy budgets and their measures | `test/support/labs.ts` | the budget, script and token checks | a doc that quotes a figure gives its date |

The one exact consistency readers need is between the picture and the app, and it holds without a copy: the same core, seed and actions give the same state.

## Alternatives considered

| Option | What a visitor gets | Trades | Door |
|---|---|---|---|
| **Models of our own on a shared kernel, in the browser (chosen)** | the faults and settings they choose, a verdict at every event, and a link that replays the run | $0, no quota and no abuse surface; exact replay; thousands of seeds swept in CI. The model is ours: it shows what its rules say and no more, and its rules can be wrong | two-way |
| A real broker, cache and scheduler, live on Durable Objects or containers | the real software, with real timing | A broker in a Durable Object writes about 300 to 600 rows a session, so about 170 to 330 sessions a day fill the Free cap ([lab.md](../lab.md#per-session-cost-and-free-headroom), the Outbox Lab). Containers are Paid-only, start cold in 1 to 3 s and bill while awake ([lab.md](../lab.md#weaker-designs-and-why)). It is an abuse surface and a service to run, and its runs cannot replay: real clocks and networks take no seed, so no link reopens a run and CI cannot sweep seeds. And the platform ([ADR 0009](0009-lab-worker-same-origin.md)) is not built | one-way-ish: a protocol and a service to keep |
| An existing simulation engine, embedded | a proven engine | SimPy 4.1.2 (MIT) is Python: in the browser it needs Pyodide, whose core for 314.0.7 is 6,365,241 B gzip -9, about 530 times a lab's 12,000 B. SimScript 1.0.37 (ISC) is TypeScript: its core, bundled and minified, is 7,077 B gzip -9, against 592 B for `lib/sim`'s agenda and stream. It seeds each random variable on its own, with `Math.random` by default, and runs itself as an async loop paced by the wall clock (`Date.now`, `requestAnimationFrame`), so recording presses and replaying them exactly would still be ours to build. Both measured on 2026-10-31 from the published packages | two-way |
| A recording or a video of each scenario | the run Joseph picked | The cheapest, and nothing to break: no input and no proof ([lab.md](../lab.md#why-a-lab)) | two-way |

The weaker design is a scripted animation: lamps that light in a fixed story. It would look the same until a visitor changed a setting, and then it would have nothing to say.

## Consequences

- **Three more labs at $0 to run**: static files, no Worker invocation, no cookie, nothing stored or sent.
- **One row registers a simulated lab** in `test/support/labs.ts`: its slug, its bundle, its sheet's map class and its lazy budget. The script, budget and token checks loop over the rows. A lab's module is allowed on its own page and refused on every other lab's, all twelve pairs. Its page also adds its slug to `OWN_PAGE` and its URL to `published-urls.txt`.
- **A lab's lazy budget counts every chunk its module can load**, a shared chunk in full in each lab. Nothing a lab loads may be loaded eagerly by any page, whether it names the script or preloads the module, or by anything but a simulated lab's module.
- **The entries waited for Joseph's read.** Each carried the placeholder review stamp, which CI's review stamp check refuses, until he had read the three beside his résumé ([lab.md](../lab.md#rules-for-every-demo), "Cleared as a set"). They carry his stamp of 2026-10-31, and the three labs shipped that day, in build `f193bc1`.
- **Known debt:**
  - **One random stream per run, so a setting that takes draws moves everything after it.** On the same seed, coalescing turns the Cache Lab's opening 1,500 reads into 1,515, and jitter into 1,555. A prefetch of 10 publishes 41 orders by 4.0 s where the Queue Lab's opening publishes 38, differing from the ninth on. One run at a time makes Monday's load fail in the Backfill Lab's week as well as Wednesday's (counted 2026-10-31). Some settings leave every draw where it was, as the Queue Lab's key and acknowledgement do in its opening, and the Backfill Lab's load mode and partition in its, and those tries compare cleanly. Common random numbers, a stream for each kind of draw, would make every comparison controlled, at the cost of every pinned number in the entries and the tests.
  - **Test-only fault branches ship in every lab's chunk**, the Raft Lab's too: all thirteen fault names are in the built chunks, about 118 B of them in the Queue Lab's. Taking them out needs a build-time constant the bundler can drop.
  - **The run loop is written four times.** The kernel shares the stream and the agenda, but each core has its own `step`, `runUntil` and `replay`. The same two bugs came up in three copies each, found by separate reviews: a frame cut short ran events late in the Raft, Cache and Backfill cores, and an action landed where its replay could not put it in the Raft, Queue and Backfill cores. The fixes went three ways (the table above). By the rule of three the loop belongs in `lib/sim`, and a fourth simulated lab should take it from there instead of copying one.
  - **What the models leave out.** The Queue Lab has no delivery timeout, so a worker that records the key in a second step breaks exactly the 1,168 runs that no key breaks: the race that fault stands for needs a redelivery that overtakes a slow worker. The Cache Lab leaves out the race in which a fetch stores a stale value after a delete. A load stopped by a clear writes nothing.
- **A copy had already drifted.** [design-system.md](../design-system.md)'s budget table said no lazy JavaScript ships outside the Route and Raft Labs, and gave the Raft Lab's app as 6,553 B (2026-10-27), where `test/support/labs.ts` recorded 6,861 B, and its motion table gave the Raft Lab's still step as 50 virtual ms, where every lab's is now half a second of the chosen speed (25 ms at Steady). The edit waited for [ADR 0025](0025-signal-box-identity.md)'s rewrite of the same file, and was made once both were on main: its rows for the simulated labs now name that table rather than copy figures from it.
- **The Raft Lab keeps one difference**: its Start over moves to the next seed, and from 999,999 back to 0, the highest seed a link names. Its link is read and written by `lib/sim/link.ts` too, and names the share of messages lost, the one setting a run starts with (`#seed-8&loss=30`).

## Door

Two-way for the pages, the links' settings and the budgets. Every file is static. A lab withdraws by removing its entry, and its URL then answers 404 ([ADR 0005](0005-url-scheme.md) would want a 301 to /lab/). A budget is one number in one table.

The kernel's determinism is the load-bearing part. Every opening picture, every number an entry quotes, every pinned test and every count above depend on the generator and on the agenda's order for ties, and so does every link a visitor has shared. Changing either, common random numbers included, moves all of them at once, and a shared link then opens another run. So the kernel changes only in a commit of its own, which updates every pinned number and says which links it breaks. For links already shared, that is a one-way door.

## Revisit if

- **A lab's lazy graph passes its budget**, its measure rounded up to the next 500 B: the Queue Lab's is 26 B inside its 12,500 B. Before raising any budget again, take the test-only branches out of the shipped chunks. If a lab still needs more, split its view from its model rather than grow one chunk.
- **A fourth simulated lab needs what the kernel cannot do**, such as a process that waits on two events at once, a resource lent to many entities and taken back, or more than one stream. Then move the run loop into `lib/sim` and add what is missing there, or measure an engine against the budget first, as the alternatives above were.
- **A visitor-facing slowdown is measured on a lab page**: Lighthouse CI's largest contentful paint (2,500 ms) or layout shift (0.1) fails on one (`lighthouserc.json`), or a phone drops frames while a run plays. A frame runs up to 4,000 events, 2,000 in the Backfill Lab. Then lower that cap, or run the model in a Web Worker, as the Route Lab runs its solver.
- **A link or a replay opens a run other than the one it names.** Determinism is then broken, and the seed and the actions become a known answer in the core's tests before the fix.

## Prior art

- **Deterministic simulation testing.** FoundationDB built a deterministic simulator of its whole cluster, with disk, process and network faults, before it built the database (Jingyu Zhou et al., "FoundationDB: A Distributed Unbundled Transactional Key Value Store", SIGMOD 2021; Will Wilson, "Testing Distributed Systems w/ Deterministic Simulation", Strange Loop 2014). TigerBeetle's VOPR does the same for its database. The labs take the pattern at the size of a page: a model, a seed, a sweep.
- **Discrete-event engines**: SimPy, process-based, in Python; SimScript, in TypeScript. Both are measured under Alternatives.
- **What each entry credits:**
  - Queue: the acknowledgements, prefetch and dead-lettering of the AMQP 0-9-1 protocol, described without any one broker's details; Brandur Leach, ["Implementing Stripe-like Idempotency Keys in Postgres"](https://brandur.org/idempotency-keys) (2017); Little's law, John D. C. Little, "A Proof for the Queuing Formula: L = λW" (*Operations Research*, 1961).
  - Cache: Andrea Vattani, Flavio Chierichetti and Keegan Lowenstein, ["Optimal Probabilistic Cache Stampede Prevention"](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf) (VLDB 2015), the XFetch rule; Rajesh Nishtala et al., ["Scaling Memcache at Facebook"](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala) (NSDI 2013), the leases coalescing stands in for; [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861), stale-while-revalidate; David Karger et al., "Consistent Hashing and Random Trees" (STOC 1997), the hash circle.
  - Backfill: Maxime Beauchemin, "Functional Data Engineering: a modern paradigm for batch data processing" (2018): runs that belong to their day of data, and loads that replace a day's rows.
- **Metastable failure**, the failure the Cache Lab leaves out: Nathan Bronson et al., "Metastable Failures in Distributed Systems" (HotOS 2021); Lexiang Huang et al., "Metastable Failures in the Wild" (OSDI 2022).

## Patterns and further reading

- **Deterministic lockstep**: inputs applied only at boundaries every replay shares give the same simulation every time. Glenn Fiedler, ["Deterministic Lockstep"](https://gafferongames.com/post/deterministic_lockstep/) (2014).
- **Next-event time advance**: Averill M. Law, *Simulation Modeling and Analysis* (6th edition, 2024), chapter 1.
- **Common random numbers**, the fix for the first debt: the same book's chapter on variance reduction.
- **Event sourcing, in miniature**: a run is its seed folded over the presses recorded in it. Martin Fowler, ["Event Sourcing"](https://martinfowler.com/eaaDev/EventSourcing.html) (2005).
- **Mutation testing**, the broken variants each sweep must catch: Richard DeMillo, Richard Lipton and Frederick Sayward, "Hints on Test Data Selection: Help for the Practicing Programmer" (*IEEE Computer*, 1978).
- **An independent test oracle**, the Queue Lab's count rebuilt from each order's record: Earl Barr et al., "The Oracle Problem in Software Testing: A Survey" (*IEEE Transactions on Software Engineering*, 2015).
- **Tolerant reader**, the link: Robert Daigneau, *Service Design Patterns* (2011).
- **Fitness functions**, the budgets and the one-row table: Neal Ford, Rebecca Parsons, Patrick Kua and Pramod Sadalage, *Building Evolutionary Architectures* (2nd edition), chapter 2.
- **The rule of three**, for the run loop: Martin Fowler, *Refactoring* (2nd edition, 2018), chapter 2.

## Postscript 2026-10-31

**The Cache Lab gains the retry storm that Modelling decisions left for a decision of its own.** Two settings, both at today's behaviour until the visitor changes them: what a reader does when it times out (give up, retry at once, or retry with backoff and full jitter, after Marc Brooker, "Timeouts, retries, and backoff with jitter", Amazon Builders' Library, 2019), and whether the pool drops a fetch nobody waits for any more (on). A reader asks at most three times; backoff waits a uniform draw up to 2 s, then up to 4 s (`RETRY` in `core.ts`). A link names the two after every other setting and leaves out the defaults (`#seed-7&retry=at-once&drop=off`), so every link already shared opens the same run. At the defaults every pinned number, the opening, the links and the index facts are unchanged: `test/cache.test.ts` and `test/cache-lab.test.ts` pass without an edit. The backoff's draw comes from the run's one stream, and only when a reader backs off.

With retries at once and nothing dropped, the morning rush and a flush at 5.0 s, then calm half a second later, leave the line for the database in the thousands at calm load: the sustaining effect of Bronson, Aghayev, Charapko and Zhu ("Metastable Failures in Distributed Systems", HotOS 2021) and Huang et al. (OSDI 2022). Over seeds 1 to 200 from the opening's run (`test/cache-storm.test.ts`; a storm is a line of 100 or more at every 100 ms from 10 s to 30 s after calm returns):

| Settings | Storm | Line emptied for good after calm returned: median, 90th, worst |
|---|---|---|
| Give up, drop (the lab as it was) | 0 of 200 | 1.4 s, all 200 |
| Give up, keep | 9 of 200 | 191 recover |
| Retry at once, keep | **190 of 200 (95.0%)** | 10 recover |
| The same with no trigger, calm again at 5.5 s | 1 of 200 | |
| Retry with backoff, keep | 150 of 200 | 50 recover |
| Retry at once, drop | 0 of 200 | 2.6, 3.2, 4.0 s, all 200 |
| Retry with backoff, drop | 0 of 200 | 1.7, 2.1, 3.0 s, all 200 |

Applied at 20 s to the 190 storms, dropping empties the line in every one (2.6, 3.3 and 3.8 s), backoff and dropping together in every one (2.2, 2.7 and 3.2 s), and backoff alone in none. Backoff sends as many retries, later: in an open system it delays the work instead of shedding it (Marc Brooker, "Fixing retries with token buckets and circuit breakers", 2022). What ends the storm is dropping the work nobody wants. A pilot over the first 60 seeds found 57 storms; 200 seeds put a 95% interval of about ±3 points on a share near 95%.

Two rules of this record bent, and why:

- **Conservation's walk of the line is skipped while dropping is off** (`check.ts`). A fetch in line with no reader waiting is the lesson then, not a bug. Turning dropping on takes every such fetch out at once, as each would have left when its last reader gave up, so the walk holds again from that moment.
- **The Cache Lab's budget rises to 12,000 B.** Measured on 2026-10-31, gzip -9: 11,848 B, its app 10,929 B with the link's 327 B and the agenda's and stream's 592 B, from 11,166 B. Revisit if asks two things first. The test-only fault branches left the shipped chunk: they now sit behind `import.meta.env?.MODE === 'test'`, which Vite fixes at build, about 80 B. This ties the core to Vite, the cost this record named. The build and Vitest are Vite; Playwright also loads the core, for `e2e/index.spec.ts`, and has no `import.meta.env`, so the check reads it with `?.` and the faults are off there, as they should be. Splitting the view from the model would not lower the figure, since the budget counts every chunk the module loads, and would add a chunk's overhead. The rest, about 760 B, is the two settings, their controls, the event log's lines and the retries counted beside the readers. 12,000 B is the measure rounded up to the next 500 B (`test/support/labs.ts`). The review's fixes the same day, the event log counting a reader who timed out and asked again apart from one who gave up, and the retries beside the readers said as a rate, took it to 11,963 B. That leaves 37 B: the next change to the Cache Lab's app meets this budget first, and the answer then is to take something out, as the fault branches were, before raising it again.

The decision stands. A Revisit if condition was met, a lab's lazy graph passing its budget, and was answered as it asks.
