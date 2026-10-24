# ADR 0009: One lab Worker for all Durable Objects, on /lab/api/*

Status: Proposed · 2026-10-22 · Deciders: Joseph Peterson

## Context

The site is an assets-only Worker, `ihaveasegway-web`, on the custom domain `ihaveasegway.com` ([ADR 0002](0002-host-on-workers-static-assets.md)). Its page views run no Worker code, so they never count toward the Workers Free plan's 100,000 requests a day ([ADR 0008](0008-workers-free-with-guardrails.md)). Its deploys upload a version, smoke-test that version's URL, then promote it ([ADR 0006](0006-github-actions-owns-deploys.md)). In Phase 4 the lab adds live demos built on Durable Objects (DOs): Presence, Outbox Lab, Migration Lab, and later Route Lab. Each demo's write-up is a static page at `/lab/<slug>/` ([ADR 0005](0005-url-scheme.md)).

Platform facts that shape the choice, as of 2026-10-22:

- "Version URLs are not generated for Workers that implement a Durable Object." ([Version URLs](https://developers.cloudflare.com/workers/configuration/previews/))
- Deploying a new version restarts every DO in that Worker and disconnects every WebSocket. Rollback is blocked across a DO class lifecycle change, and only one version of each DO class runs at a time. ([WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/), [gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/))
- A route Worker runs before a custom-domain Worker on the same hostname, and the custom-domain Worker "is treated as an origin". So a route on `/lab/*` would make every view of a lab write-up a Worker invocation. ([custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/))
- Free caps belong to the account. Separate Workers isolate code and deploys, not quota.
- A Worker Preview gets its own DO namespace for classes defined in the same Worker. Cross-Worker (`script_name`) bindings are not covered, and rate-limit namespaces and Analytics Engine datasets are shared unless re-bound. ([Preview resources](https://developers.cloudflare.com/workers/previews/resources/))
- Browsers apply no CORS to WebSocket handshakes and send the page's cookies with them, so an upgrade must check `Origin` itself ([OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)).

No planned demo renders visitor-supplied markup or third-party embeds, and the site sets no cookies.

## Decision

- One Worker, `ihaveasegway-lab` in `workers/lab/`, holds every DO class: `LabControl`, `PresenceRoom`, `OutboxSandbox`, `MigrationSandbox`, and later `RouteRoom`. Classes are SQLite-backed and declared with `exports`, never the legacy `migrations` array; the two cannot be mixed in one Worker.
- Its only entry is the zone route `ihaveasegway.com/lab/api/*`, with `workers_dev: false` and `preview_urls: false`. Spike S5 checks whether Worker Previews still publish on workers.dev with both settings off.
- Write-ups at `/lab/<slug>/` and recorded runs stay static assets on `ihaveasegway-web`. `api` is a reserved lab slug.
- Same origin: no CORS; CSP `connect-src 'self'`; the session cookie is `Path=/lab/api; HttpOnly; Secure; SameSite=Strict`; an upgrade needs `Origin` to be exactly `https://ihaveasegway.com`.
- The site never calls the lab. The browser composes the two.
- No demo state lives longer than 15 minutes.

Admission, limits, the kill switch and the demo designs are in [lab.md](../lab.md).

## Alternatives considered

| Option | Gains | Costs | Verdict |
|---|---|---|---|
| The lab on `lab.ihaveasegway.com`, as a custom domain of the lab Worker | Security: origin isolation from the site. Operability: a hostname-level kill switch (detach the domain) | Latency and operability: CORS on every API call, a second origin in the CSP, an extra Turnstile hostname, another DNS record and certificate. The isolation guards against demos that render visitor markup or third-party embeds, and none do; the site has no cookies to steal | Rejected for now |
| One Worker per demo, behind a gateway Worker with service bindings or a route each | Availability: independent deploys and rollbacks, so an Outbox Lab deploy no longer drops Presence sockets | Operability: a config, deploy job and secret set per demo. Security: cross-Worker DO bindings get no per-preview namespace, so previews could reach production objects | Deferred |
| DOs inside the site Worker | Operability: one config and one deploy. Cloudflare's full-stack guidance serves frontend and backend from one Worker in a single deployment ([blog, 2025-04-08](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/)) | Availability and reversibility: the site loses Version URLs, and with them the smoke test before promotion. Every lab deploy redeploys the pages, and every site deploy drops every lab socket. A DO class change blocks rolling back the site | Rejected |
| A second Cloudflare account for the lab | Availability: the only real quota bulkhead | Operability: a route on the apex must live in the zone's account, so the lab would need another hostname, another deploy token and another account to secure | Rejected unless spike S1 fails |

Cloudflare's one-Worker default is sound for an app. It does not fit here, because the site's deploy pipeline depends on what a Worker with DOs gives up: Version URLs and clean rollbacks.

## Consequences

- The site keeps Version URLs, gradual deployments and clean rollbacks. Lab deploys never touch pages.
- One enforcement point. Only the lab Worker holds DO bindings, so every request passes the same admission checks, and every kill-switch level targets one path prefix. Deleting the route drops `/lab/api/*` through to the site's 404 page, a free asset.
- Every lab deploy drops every lab socket, Presence included. Clients reconnect with backoff and resume from a snapshot. Lab deploys avoid dates when a demo is likely to be watched.
- The demos share a blast radius: one class's bug ships with all of them. Per-session caps and per-demo budgets bound the damage, and a per-demo flag turns one demo off.
- A DO class lifecycle change blocks rollback across that deploy, so each one ships alone, at 100%, with its demo flagged `off` until it is healthy.
- The site and the lab still share the account's Free quota. The site survives a lab that exhausts it only because its pages run no Worker code; spike S1 checks that before Phase 4.
- Same origin means a script injected into a lab page would run with the site's origin. Nothing of value lives there (a theme value in sessionStorage, for the tab, and no cookie outside `/lab/api`), which is why isolation buys little today.
- Lab previews stay off until spikes S5 and S6 pass. Until then, lab changes are tested with `wrangler dev` and `@cloudflare/vitest-plugin`.

## Door

Two-way for the topology. No demo state outlives 15 minutes, so moving a class into its own Worker, or the API to a subdomain, is a config change plus one client constant, with no demo data to migrate. `LabControl`'s flags and ledger can move with an `exports` transfer (`transferred` on one side, `expecting-transfer` on the other). `/lab/api/*` is not a public contract; only the site's own scripts call it.

One-way-ish for each DO class's lifecycle. Once a class is deployed, it is renamed or deleted only through `exports` tombstones, and rollback is blocked across the change. The write-up URLs are near one-way too, but [ADR 0005](0005-url-scheme.md) owns them.

## Revisit if

- Lab deploys drop live sessions more than once a week. Then split into one Worker per demo, after checking how previews isolate cross-Worker DO bindings.
- A demo ever renders visitor-supplied markup or third-party embeds. Then move the lab to `lab.ihaveasegway.com` for origin isolation.
- Spike S1 fails: static assets stop serving once the account's daily cap trips. Then the lab's quota is the site's quota, and the lab stays dark until the plan changes ([ADR 0008](0008-workers-free-with-guardrails.md)).
