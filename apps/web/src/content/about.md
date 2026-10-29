---
firewall_reviewed: 2026-10-29
---

I'm a software engineer working toward software architecture: the decisions that are expensive to change, made with numbers and written down where the next person can find them. This site is that work, in the open.

### How I work

- **The reasoning comes before the code.** The decisions behind this site that would be hard to reverse are written down: the options each one beat, what it trades, and the evidence that would show it was wrong.
- **I look for what already exists before I build.** The Route Lab plans its routes with VROOM, an open-source solver compiled to WebAssembly, not with a solver of mine. The Raft Lab is the exception, because the point was to understand Raft by writing it, and 3,000 seeded runs with faults check it.
- **Rules live in the build.** Page weight, contrast, keyboard access, a résumé that prints on one page and the safety of the Raft cluster are tests that fail a pull request.
- **Cost and privacy are settled before the first line.** The site is hosted on a plan that stops at its limits instead of billing, and the demos run entirely in your browser.
- **Two-way doors close fast and open again.** This site's content went to 1,792 px wide one evening and came back to 1,312 px 74 minutes later, when it read as too wide.

### What I'm working toward

Systems where the hard part is agreement, failure or cost: consensus, durable state, and what each trade-off costs. The Lab is where I build them, in pieces you can break.
