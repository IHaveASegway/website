---
firewall_reviewed: 2026-10-31
---

I'm a software engineer who builds the systems work flows through: queues, data pipelines, caches and the clusters under them, and now the lines where agents write the code. I'm working toward architecture: the decisions that are expensive to change, made with numbers and written down where the next person can find them.

### What I build

- **Queues that lose nothing.** Brokers, workers and the acknowledgements between them, set so a crash costs a retry instead of an order. The Queue Lab shows where each setting breaks.
- **Caches that hold under load.** Expiry, coalescing and early refresh, tuned so one hot key cannot flatten the database behind it. The Cache Lab stampedes one on purpose.
- **Pipelines that count once.** Scheduled job graphs, change data capture and backfills that can run a day twice without counting it twice. The Backfill Lab runs a week of them.
- **Platforms that stay up.** Clusters, managed databases and serverless functions on two clouds, with the bill known before the first deploy. The Raft Lab is the part of that I can show here: five servers that agree while you break them.
- **Lines where agents write the code.** Specs, walls, checks and releases around coding agents, so a team keeps its judgment and stops typing. My essay on the road that closed says how.

### How I work

- **The reasoning comes before the code.** The decisions behind this site that would be hard to reverse are written down: the options each one beat, what it trades, and the evidence that would show it was wrong.
- **I look for what already exists before I build.** The Route Lab plans its routes with VROOM, an open-source solver compiled to WebAssembly, not with a solver of mine. The Raft Lab is the exception, because the point was to understand Raft by writing it, and 3,000 seeded runs with faults check it.
- **Rules live in the build.** A Raft cluster that keeps its five safety properties, a queue that never loses or doubles an order, a cache node that never fetches one page twice at once: each is a test over 600 to 3,000 seeded runs that fails a pull request.
- **Cost and privacy are settled before the first line.** The site is hosted on a plan that stops at its limits instead of billing, and the demos run entirely in your browser.
- **Two-way doors close fast and open again.** This site's content went to 1,792 px wide one evening and came back to 1,312 px 74 minutes later, when it read as too wide.

### What I'm working toward

Systems where the hard part is agreement, failure or cost, and engineering lines where agents do the typing and people keep the judgment. The Lab is where I build them, in pieces you can break.
