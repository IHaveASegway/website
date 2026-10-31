# ADR 0020: The Raft Lab is a deterministic simulation in the browser, with its own Raft and a safety checker

Status: Proposed · 2026-10-27 · Deciders: Joseph Peterson

## Context

On 2026-10-27 Joseph chose a Raft demo for the lab: something a visitor can break that shows how consensus survives crashes, partitions and lost messages. The need behind it is the lab's own (lab.md, "Why a lab"): inputs the visitor chooses, here the faults, and proof that the system runs. A recording or a diagram shows neither.

Consensus has well-known prior art, and the question is which part of it fits:

- **RaftScope**, Diego Ongaro's visualization on the Raft website (github.com/ongardie/raftscope; an ISC-style license, © 2014 Stanford University; last pushed 2024-07-08). Five servers on a circle, messages in flight, a log per server, crash and restart by clicking. It is the picture every Raft reader knows. It ships jQuery and Bootstrap 3.1.1, and it has no checker: a visitor sees what happens, not whether it was safe.
- **etcd/raft and hashicorp/raft**, the Go libraries behind etcd, Consul and Vault. Battle-tested, but Go compiled to WebAssembly is about 1.24 MB gzip for this site's earlier core (the backend-language research of 2026-10-23), against a 150 KB page budget. They are also libraries, not simulations: the simulator, the network, the faults and the checker would still be ours.
- **Deterministic simulation testing**, the pattern FoundationDB made known (Will Wilson, "Testing Distributed Systems w/ Deterministic Simulation", Strange Loop 2014) and TigerBeetle's VOPR follows: the system runs in virtual time on a seeded random stream, so a failing run is a seed that replays exactly, and a sweep of seeds searches for bugs faster than real time.

## Decision

**The Raft Lab runs a Raft written here, in TypeScript, inside a deterministic simulator, with the five safety properties checked after every event, at `/lab/raft/`, in the browser.**

- **The servers** (`src/lib/raft/core.ts`) follow Figure 2 of Ongaro and Ousterhout's paper (USENIX ATC 2014): RequestVote with the up-to-date check of section 5.4.1, AppendEntries with the consistency check and conflict cut, and the leader's commit rule of section 5.4.2, which commits only its own term's entries by counting. A crash keeps the term, the vote and the log; everything else is lost. No membership changes, no snapshots, no PreVote.
- **The simulator** (`sim.ts`) owns time, the network and chance: one seeded mulberry32 stream for every timeout, latency and loss, a partition as a side per server, and every visitor action recorded at its virtual time. The same seed and the same actions give the same run, event for event (`test/raft.test.ts`, "determinism").
- **The checker** (`check.ts`) tests Election Safety, Leader Append-Only, Log Matching, Leader Completeness and State Machine Safety after every event, in a few comparisons each: every log carries prefix fingerprints, so two logs are compared at one index. On the page it says how many events held; on a break it names the property and freezes.
- **The sweep** runs 3,000 seeded runs in CI, about 2 s of the suite: 8 virtual seconds of random crashes, restarts, splits, heals, loss up to 30% and writes every 150–500 ms; then the network heals and a client writes every 250 ms until one commits. Every run must keep all five properties, and commit a write within 2.75 s of healing.
- **Two broken servers prove the sweep finds bugs**, exposed only to the tests (`Faults` in core.ts): one votes without the up-to-date check, and one commits an older term's entry by counting replicas, the bug of the paper's Figure 8. Measured on 2026-10-27, the first breaks Leader Completeness in 550 of the 3,000 runs, first at seed 8; the second in 2 of them, first at seed 523. The Figure 8 bug needs a rare schedule, a leader that copies an old entry to a majority and crashes before its own term's entry follows, which is the point of the figure.
- **The page** opens on a picture the build drew from the opening run (seed 7, three writes), complete without JavaScript. The app loads on intent and replays the same opening, so it takes over at the picture's exact moment. It moves only between Run and Pause.

Measured on 2026-10-27, gzip -9 with zlib:

| | Bytes | Budget |
|---|---|---|
| Boot module, eager on its page only | 445 | in the page's 5,000 of eager JavaScript: 3,407 with the theme script, the menu and the preload helper |
| App chunk (servers, simulator, checker, drawing), on intent | 6,527 | 8,000, its own (support/measure.ts, `raft-lab`) |
| First view with the app | within 150,000 | the 150 KB every page but the Route Lab's keeps |

## Alternatives considered

| Option | Bytes | What a visitor gets | Door |
|---|---|---|---|
| Embed or port RaftScope | its own code, plus the jQuery and Bootstrap 3.1.1 it bundles | the known picture, without a checker, and someone else's code presented as the work | two-way |
| **Own Raft, deterministic simulation and checker (chosen)** | 6,527 B lazy | faults they choose, a verdict on every event, and a seed that replays | two-way: static files only |
| etcd/raft or hashicorp/raft compiled from Go to WebAssembly | about 1.24 MB order of magnitude | a production library, with the simulator and checker still to write | two-way, but over every budget by ten times |
| A live cluster of Durable Objects | a WebSocket and five objects a visit | real network delays, at a quota cost and an abuse surface, for less control over faults | one-way-ish: a protocol to keep |

The weaker design is the animation alone: messages flying with no checker would look the same while broken, and the two mutations would pass unseen.

## Consequences

- The lab gains a second demo at $0 to run, with no Worker invocation and no abuse surface.
- `lib/lab.ts` gains `OWN_PAGE`: a demo with a page file of its own, which `[demo].astro` leaves out, so neither demo's page links the other's styles or code. The Raft Lab's page is `pages/lab/raft/[...index].astro`, which builds only while its entry is live.
- **The budgets now count what an eager script imports statically.** With two demos, Vite moves its preload helper into a shared chunk (852 B) that both entries import. A count of `<script src>` alone would have missed it on both pages, and booked it as the Route Lab's lazy code. `support/measure.ts` now counts every static import of an eager script as eager. The Route Lab's page reads 4,064 B of eager JavaScript instead of 3,884: the helper's cost as a chunk of its own.
- Home gains a card for the demo (lib/lab.ts, `labCards`), and /lab/ a second row.

## Door

Two-way. Every file is static; the demo can be withdrawn by removing its entry, and its URL then answers 404 (ADR 0005 would want a 301 to /lab/ instead).

## Revisit if

- The sweep stops catching either broken server within its 3,000 seeds after a change to the fault schedule or the timing: the sweep has gone blind, and its schedule needs widening before anything else changes.
- A visitor finds a run that breaks a property with the real servers: the seed and the actions replay it, so it becomes a known answer in `test/raft.test.ts` before the fix.
- A demo needs real network behaviour that a simulation cannot honestly show, such as clock skew across machines: then a cluster of Durable Objects, with the lab platform of ADR 0009.

## Postscript 2026-10-31

The mutation figures in Decision are wrong, and no committed version of the sweep gives them. Counted over every one of the 3,000 seeds on 2026-10-31, with `faultyRun` from `test/raft.test.ts`, whose test stops at the first seed that catches each server and so never printed a total:

| Broken server | Runs that break a property | First at seed | Recorded above |
|---|---|---|---|
| Votes without the up-to-date check (`anyLogVotes`) | 774 of 3,000, each by Leader Completeness | 2 | 550, first at seed 8 |
| Commits an older term's entry by counting (`oldTermCommits`, Figure 8) | 4 of 3,000, each by Leader Completeness | 523 | 2, first at seed 523 |

The counts are the same at b6f709c, the commit that built the lab and wrote this record, at 37faf7c, just before the fix below, and at 983f735, after it. The servers, the simulator, the checker and `faultyRun` did not change between the first two, and the sweep without faults runs the same 3,274,892 events at all three.

The fix, 8c36fbe: a frame cut short keeps time, and an action lands where its replay puts it. `runUntil` with an event limit moved the clock to the frame's end even when the limit had stopped the frame first, so the events still due ran late. It now stands at its last event, and stops only between two moments. Every action now first runs the events still due in its millisecond, as the Queue Lab's do ([ADR 0026](0026-three-more-labs-simulated-in-the-browser.md)), so a replay puts it where the run did. Runs moved without a limit never stood inside a millisecond, so the opening, the 3,000 runs and both catches are the same before and after.

The decision stands, and no Revisit if condition was met: both broken servers are still caught within the 3,000 seeds. lab.md's Raft Lab section carries the corrected counts.
