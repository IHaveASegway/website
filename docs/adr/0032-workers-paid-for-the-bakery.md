# ADR 0032: Workers Paid for the account, when the bakery demo launches

Status: Proposed · 2026-11-04 · Deciders: Joseph Peterson

## Context

[ADR 0008](0008-workers-free-with-guardrails.md) kept the account on Workers Free and named five triggers for the move to Paid: a Container-backed demo, the first Error 1027 or a day above half of a Free daily cap, a route that needs more than 10 ms of CPU, a dated moment where demo uptime matters, and email to arbitrary recipients or more than 10,000 Queues operations a day. It also said what the move would look like: a dated, deliberate change with a checklist, never a reaction to a bill.

On 2026-11-04 Joseph started a second system on the same account: the bakery demo, the made-up bakery the labs simulate, built as a running business system with every backend in Rust and its state in Durable Objects (DOs), in its own public repository ([IHaveASegway/bakery](https://github.com/IHaveASegway/bakery), whose `docs/` own its design, cost model and plan). It is an application with sign-in, a Stripe webhook endpoint, a nightly wipe and a live kitchen board, and it fires two of ADR 0008's triggers on its own: a password hash in a stateless Worker needs more than 10 ms of CPU (the third trigger), and a busy day passes 10,000 Queues operations (the fifth). On Free it would serve about 20 sandboxes a day before rows written run out, and a tripped cap would drop Stripe's webhooks for the rest of the UTC day. Joseph decided the plan question the same day, in the bakery's Q27 and Q28: Workers Paid, "yes on workers for site", with a ceiling of $100 a month for the account, which replaces his $50 answer to Q11 · Q-budget of 2026-10-23.

The plan is per account, so the site moves with the bakery. As of 2026-11-04, Workers Paid is $5 a month minimum per account, 10 million requests and 30 million CPU-ms a month included, with no spend cap; budget alerts notify only, on usage, processed daily ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)). A Custom Domain needs its zone in the same account ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)), which is why the bakery's two hostnames on this zone cannot live in a second account. The bakery's [cost.md](https://github.com/IHaveASegway/bakery/blob/docs/plan/docs/cost.md) prices its own usage: $5.00 a month at a quiet month, $5.29 at its own daily caps, and $0 until its launch pull request, since nothing of it is deployed before then.

## Decision

1. **The account moves to Workers Paid in the bakery's launch pull request**, not before: until then the bakery runs on `wrangler dev` and the site stays on Free, as ADR 0008 says. The date goes into this record's postscript.
2. **ADR 0008's item 6 applies on that day**, with one change: budget alerts at $10, $25, $50 and $100, the last being Joseph's new ceiling for the account (Q-budget: $100 from 2026-11-04). The rest stands: `limits.cpu_ms` on every Worker with code, the zone's one rate-limiting rule, and the 15-minute cron breaker. The zone has one rate-limiting rule on its Free plan, so its expression covers both the lab's `/lab/api/*` and the bakery's API hostname at one threshold, and the breaker, which lives in the bakery's API Worker, may enable the lab's pre-built kill rule as well as the bakery's; confirm both when building.
3. **ADR 0008's other decisions stand.** Pages stay static assets with Workers Cache off; the lab's guardrails are built as if Free's caps still applied, which on Paid is what turns "no cap" into a computed worst case; SQLite-backed DOs only, so the way back to Free stays open.
4. **ADR 0008 is superseded in part**, in its first item, by this record once Joseph accepts it. It stays Accepted for everything else, with a postscript that says so.

## Alternatives considered

| Option | Gains | Costs | Verdict |
|---|---|---|---|
| **Paid for the account at the bakery's launch (chosen)** | Availability: the bakery serves 300 sandboxes a day instead of 20, and the lab gains the same headroom. Operability: one upgrade day, one checklist, for both systems | Cost: $5 a month, and an open tail the guardrails bound. Operability: alerts to watch from launch day | Chosen |
| A second Cloudflare account for the bakery | A real quota and bill bulkhead from the site | Feasibility: a Custom Domain on this zone needs the zone in the account; the bakery would need another domain, which Joseph did not ask for ([ADR 0009](0009-lab-worker-same-origin.md) rejected a second account for the lab on the same ground) | Rejected |
| The bakery on Free, with its caps | Cost: the hard $0 ceiling | Availability: about 20 sandboxes a day, Stripe webhooks dropped after a tripped cap, and no 10 ms budget for a password hash; the bakery's own cost.md says what darkens | Rejected by Joseph on 2026-11-04 |
| Move now, before anything launches | Nothing: no bakery traffic exists yet | Cost: $5 a month for nothing, and ADR 0008's reason for waiting still holds | Rejected |

## Consequences

Good:

- The move is the dated, deliberate change ADR 0008 asked for, with its checklist, and it happens once for both systems.
- The lab's spikes and its budgets keep their meaning on Paid: `LabControl`'s shares bound a bill instead of a quota.

Bad:

- The site's cost changes from $0 a month to $5, so [product.md](../product.md)'s "It costs nothing to run" becomes "the account costs $5 a month from the bakery's launch", and [cost.md](../cost.md)'s annual totals move to the Paid path from that date.
- The account fails open on cost from launch day. Alerts arrive a day late; the breaker is the only thing acting inside that day, and it has to exist before the first visitor.
- One rate-limiting rule serves two systems at one threshold until the zone's plan changes.
- The site's docs that describe a Free account (ADR 0008's consequences, cost.md's scenarios, the lab's Free-cap arithmetic) describe a state that ends on launch day; each keeps its Free arithmetic as the fallback and dates the change.

## Door

Two-way while only SQLite-backed DOs exist, as ADR 0008 says: going back to Free takes minutes and no data migration, since the bakery wipes every sandbox nightly and the lab keeps no state past 15 minutes. The money at stake either way is $5 a month and the tail the guardrails bound.

## Revisit if

- ADR 0008's own "Revisit if" conditions: a month's overage above the fee that traffic does not explain, a budget alert nobody expected, or Cloudflare adding a hard spend cap to Paid or changing the Free caps.
- The bakery's launch slips past 2027-05-04, six months from this record: then the site is still on Free and this record waits, with a postscript saying so.
- A second zone or account becomes necessary for either system.
