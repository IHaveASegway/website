---
firewall_reviewed: 2026-11-02
---

I build the backend systems other software runs on: queues, data pipelines, caches and the clusters under them. Lately I've been working out how to get real software out of coding agents. I came up through operations, so I know what the software is for.

### What I build

- **Message queues.** I've set up RabbitMQ, LavinMQ and SQS so that when a worker crashes, its work gets retried instead of lost. The Queue Lab lets you crash one and change each setting to see what breaks.
- **Caches.** Expiry, coalescing and early refresh, tuned so one popular page doesn't overwhelm the database behind it. The Cache Lab sets off a stampede on purpose.
- **Data pipelines.** Scheduled jobs in Airflow, change data capture and backfills that can run a day twice and still count it once. The Backfill Lab runs a week of them.
- **Cloud platforms.** Kubernetes, managed databases and serverless functions on AWS and GCP, with the bill worked out before the first deploy. I can't show that work here, so the Raft Lab stands in: five simulated servers that keep agreeing while you break them.
- **Coding agents.** Specs, scoped permissions, tests and staged releases around them, so people still make the decisions that matter. This site is how I learned it, and my essay says where I think it's going.

### How I work

- **I write down the reasoning first.** The decisions behind this site that would be hard to reverse are written down: the options I ruled out, what each choice gives up, and what evidence would show it was wrong.
- **I look for what already exists before I build.** The Route Lab plans its routes with VROOM, an open-source solver compiled to WebAssembly. I didn't need to write my own. The Raft Lab is the exception: I wanted to understand Raft from the paper, and 3,000 simulated runs with injected faults check it.
- **I turn rules into tests.** A Raft cluster keeps its five safety properties. A queue, set up correctly, doesn't lose or double an order when workers crash. A cache node with coalescing on fetches a page only once at a time. Each is a test over 600 to 3,000 simulated runs, and a failure turns the pull request red.
- **I settle cost and privacy early.** This site runs on a plan that stops at its limits, so it can't run up a bill, and the labs run entirely in your browser.
- **I go fast when a choice is easy to undo, and slow when it isn't.** This site's colors live in one file, so I change them whenever I want. Its URLs are promises, so changing one takes a written decision and a redirect.
- **Agents do the typing here.** I didn't type this site's code. Coding agents wrote it, and the first draft of most of its words. I set the direction, sent back what wasn't right, and made the calls.

### What I'm working toward

I want to be a software architect: the person who works out the decisions that are expensive to change, with numbers behind them, and writes them down for the next person. The Lab is where I practice, in small systems you can break.
