# ADR 0008: Workers Free with spend guardrails and upgrade triggers

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

The site is an assets-only Worker ([ADR 0002](0002-host-on-workers-static-assets.md)) serving static HTML ([ADR 0003](0003-astro-static-first.md)). Requests to static assets are free and unlimited on both Workers plans and never run code, so pages cost nothing at any volume. From Phase 4 the lab ([ADR 0009](0009-lab-worker-same-origin.md)) adds Worker requests and Durable Object (DO) usage on `/lab/api/*`. That usage needs a plan, and the plan decides what happens on the lab's worst day.

As of 2026-10-22 (the full price sheet, with a source for every line, is in [cost.md](../cost.md)):

- **Workers Free** costs $0. Its daily caps are per account and reset at 00:00 UTC: 100,000 Worker requests; for DOs, 100,000 requests, 13,000 GB-s of duration and 100,000 rows written. DO storage is capped at 5 GB in total, with no reset, and each invocation gets 10 ms of CPU. Past a cap, operations fail instead of billing, and Worker routes return Error 1027. It is the only hard $0 ceiling Cloudflare offers.
- **Workers Paid** costs $5 a month for included usage, then meters everything. There is no hard spend cap. Budget alerts only notify, once per billing cycle, and usage is processed once a day, so an alert arrives the day after spend crosses its threshold; a default $10 alert has been rolling out since July 2026 and excludes the plan fee. Containers and email to arbitrary recipients exist only on Paid.

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/), [launch post](https://developers.cloudflare.com/changelog/post/2026-04-13-billable-usage-dashboard-and-budget-alerts/), [default alert](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/).

Other platforms ship or document the missing piece. Vercel's Spend Management can pause every production deployment when a budget is reached, checked every few minutes ([docs](https://vercel.com/docs/spend-management)). Google Cloud documents a budget wired through Pub/Sub to a function that disables billing, and warns that this "doesn't guarantee that you won't spend more than your budget" ([docs](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)). Cloudflare offers neither, so on Paid any cap has to be built.

At this site's traffic the two plans differ by $60 a year. What differs more is how they fail. Free fails closed on cost: the bill stops at $0 and the lab goes dark until 00:00 UTC. Paid fails open: the lab stays up and the bill grows for a day before anyone hears of it. In both five-figure Cloudflare bills reported in 2026, the developers' own code was the cause or the multiplier ([cost.md](../cost.md), "Denial of wallet").

## Decision

1. Stay on Workers Free.
2. Keep every page a static asset with Workers Cache off ([ADR 0002](0002-host-on-workers-static-assets.md)), so a page view makes zero Worker invocations and a tripped cap can take down only the lab (a bulkhead).
3. Build the lab's spend guardrails into its first demo as if the account were already on Paid. Admission control: Turnstile before a session, a signed session cookie, and LabControl budgets at 70% of each Free cap, with recorded mode behind them (load shedding). Leak control: the WebSocket Hibernation API only, TTL alarms followed by `deleteAll()`, and an alarm loop guard. A kill switch: a pre-built, disabled WAF rule on `/lab/api/`. The full table is in cost.md; how the controls work is in [lab.md](../lab.md).
4. Use SQLite-backed DOs only.
5. Upgrade to Workers Paid when the first of these happens:
   1. the first Container-backed demo (Containers are Paid-only);
   2. the first Error 1027, or any day above 50% of a Free daily cap: 50,000 Worker requests, 6,500 DO GB-s or 50,000 rows written;
   3. a route that needs more than 10 ms of CPU;
   4. a dated moment where demo uptime matters: a talk, a meetup or a launch post;
   5. email to arbitrary recipients, or more than 10,000 Queues operations a day.
6. On upgrade day: budget alerts at thresholds Joseph sets (Q-budget in [product.md](../product.md); for example $10, $25 and $50), `limits.cpu_ms` on every Worker, the zone's one rate-limiting rule on `/lab/api/*`, and a cron Worker that reads analytics every 15 minutes and enables the pre-built WAF kill rule above a threshold. That circuit breaker covers the day the alerts take to arrive.

## Alternatives considered

- **Workers Paid now, at $5 a month.** It buys lab availability on a spike day, Containers, email sending and a 30 s default CPU limit, none of which anything uses before Phase 4. It costs $60 a year and gives up the hard ceiling for an open tail: without guardrails, one bot holding 1,000 non-hibernating sockets for 72 hours costs $412.50, and a container endpoint left on default settings $185.07 (cost.md, scenario D). The guardrails are needed on Paid anyway, so paying early buys no simplicity. It trades cost (an unbounded tail) and operability (alerts to watch from the first day) for the lab's availability.
- **Workers Paid with an automated kill switch only**: the cron breaker and the WAF rule, without admission control inside the lab. It is the cheapest to build and the closest thing to Vercel's pause. It is weaker on four counts. It acts after the money is spent: up to 15 minutes plus the analytics delay. It depends on WAF rules running before the Worker, which is likely but not documented (spike S2). It is all or nothing for the whole lab, so one abused demo darkens the others. And it cannot undo what already happened: objects created before it trips keep billing for storage until something deletes them. It trades availability and cost for less build effort. A breaker is the backstop for admission control, not a replacement for it.
- **Workers Free without guardrails, trusting the cap.** $0 and the least work. One bot or one bug darkens every Worker route on the account until 00:00 UTC, day after day, and the lab would need its controls retrofitted before any upgrade. It trades availability and evolvability for build effort. Rejected: the guardrails shape the lab's design (hibernation, TTLs, budgets), and adding them later means redesigning demos that already work.

## Consequences

Good:

- Cloudflare costs $0 a month. Year 1 is the domain alone: $11.17, against $71.17 on Paid.
- The worst day costs nothing. The lab goes dark until 00:00 UTC and visitors get each demo's recorded run. The pages stay up, because no page view reaches a Worker.
- The controls Free forces on the lab are the same controls that bound a Paid bill. Nothing is thrown away at the upgrade, and the guardrails turn "no cap" into a computed worst case (cost.md).
- The upgrade is a dated, deliberate change with a checklist, not a reaction to a bill.

Bad:

- The caps belong to the account and are shared with every other Worker on it. A busy demo can darken all of them, so spikes and load tests ask before they burn quota ([roadmap.md](../roadmap.md)), and with more than one live demo LabControl's budgets must share each cap.
- Some things wait for Paid: Containers, email to arbitrary recipients, more than 10 ms of CPU per request. Whether DO handlers get 10 ms or 30 s of CPU on Free is unresolved in Cloudflare's docs (spike S3); plan for 10 ms.
- Logs on Free are thin: 200,000 events a day with 3 days of retention until 2026-11-30; from 2026-12-01, 0.5 GB a day of logs and traces with 7 days of retention, and ingestion stops at the cap.
- R2 has its own meter, and nothing in its pricing ties it to the Free ceiling, so site images stay static assets.
- Two assumptions are likely but not documented: static assets keep serving after the Worker cap trips (spike S1), and WAF rules run before the Worker (spike S2). The plan depends on the first; the kill switch and the breaker depend on the second.
- Triggers must come from Workers and DO metrics, not from Web Analytics, which ad blockers undercount.

## Door

Two-way while only SQLite-backed DOs are used. Upgrading takes minutes and lifts the caps at once. Going back to Free requires deleting every KV-backed DO namespace first, because the Free plan has only ever supported SQLite-backed DOs ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Since 2026-07-09 an account without a KV-backed namespace cannot create one ([changelog](https://developers.cloudflare.com/changelog/post/2026-07-09-restrict-new-kv-backed-namespaces/)), but the rule stays written down: it is the part of this decision that keeps the way back open. A demo built on a Paid-only product, such as a container, narrows the door the same way: going back means retiring that demo first. The money at stake in either direction is $5 a month.

## Revisit if

- Any upgrade trigger fires (Decision, item 5).
- A 1027 or a dark lab lands on a day that mattered.
- A demo is deferred or cut back because of a Free limit.
- Spike S1 fails: static assets stop serving once the cap trips, so the bulkhead does not hold on Free. Upgrade before the lab ships.
- Spike S2 fails: WAF rules run after the Worker, so the kill rule and the breaker would not stop billing. Move the breaker to removing the route (kill switch L4) before the upgrade.
- After an upgrade, overage above $5 in a month that traffic does not explain, or a budget alert nobody expected: a guardrail failed.
- Cloudflare adds a hard spend cap to Paid, or changes the Free caps. A real cap on Paid would remove most of the reason to stay on Free.

## Postscript 2026-10-23

Spike S3 answered the question this record left open ("plan for 10 ms", under Consequences). On Free, a SQLite-backed DO handler ran about 250 ms of CPU per call with no limit error, while the stateless Worker in front used under 1 ms ([roadmap.md](../roadmap.md#spikes), S3). Proposed planning assumption, for Joseph to confirm: the stateless Worker keeps the 10 ms budget, which is also what the third upgrade trigger measures; a DO handler plans against [ADR 0014](0014-typescript-on-workers.md)'s trigger of 100 ms at p99, kept well under the 250 ms seen because a long handler stalls everyone in its room. This changes no decision here, and no Revisit if condition was met.

Spike S1 ran the same day and was inconclusive. Cloudflare counted 124,061 Worker requests for the account (24% over the documented 100,000 a day) with no Error 1027 in about 11 minutes past the cap ([roadmap.md](../roadmap.md#spikes), S1). So the bulkhead question this record's $0 plan rests on, whether static assets keep serving once the cap trips, is still open, and the cap is not a precise ceiling to plan against. `LabControl`'s ledger, at 70% of each Free cap, stays the primary control, which is already the design. No Revisit if condition was met.
