# ADR 0002: Host on Workers static assets, not Pages

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

The site is static HTML, CSS, fonts and images built by Astro ([ADR 0003](0003-astro-static-first.md)). It needs an apex custom domain, response headers set from a file, 301 redirects for renamed slugs, a real 404 page, trailing slashes ([ADR 0005](0005-url-scheme.md)), a preview for every pull request, and a fast rollback. In Phase 4 a lab built on Durable Objects (DO) joins it on the same origin ([ADR 0009](0009-lab-worker-same-origin.md)). Most visitors arrive through links Joseph hands out, so a traffic spike is one shared link, not a slow ramp.

What the platform offers, as of 2026-10-22:

- Cloudflare's Pages landing page (updated 2026-08-25) says "Workers supports most Pages use cases and offers a broader feature set" and "Start new projects with Workers." It gives no end-of-life date for Pages. ([Pages](https://developers.cloudflare.com/pages/))
- The Pages-to-Workers migration matrix lists preview URLs, rollbacks, `_headers`, `_redirects` and custom domains on both. Only Workers has gradual deployments, Workers Logs, Logpush, Tail Workers, source maps and Cron Triggers. Workers cannot serve a domain whose nameservers are outside Cloudflare (this one is on Cloudflare). Branch deploy controls, Pages Functions' file-based routing, Pages Plugins and Early Hints need workarounds; this static site uses none of them. Workers also does not infer 404 handling from a `404.html` file: it "must be set up manually". ([migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), updated 2026-10-12)
- "Requests to static assets are free and unlimited," and "Only requests that hit a Worker will count against your limits and your bill." Those limits on Workers Free are 100,000 requests per day per account (reset at 00:00 UTC; over the cap, Error 1027) and 10 ms of CPU per request. ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/))
- A dry-run deploy of an all-static Astro build as an assets-only Worker (framework research bench) uploaded 0.31 KiB, with no bindings and 639 asset files for 300 posts. Free allows 20,000 files per version and 25 MiB per file.
- `_headers` (100 rules) and `_redirects` (2,000 static and 100 dynamic) apply to asset responses only, never to responses a Worker generates. ([headers](https://developers.cloudflare.com/workers/static-assets/headers/), [redirects](https://developers.cloudflare.com/workers/static-assets/redirects/))
- Worker Previews (launched 2026-09-22; Wrangler 4.135.0 or later) give each branch "an isolated, production-like environment under the same Worker": 100 per Worker on Free, 100 deployments each, and `X-Robots-Tag: noindex` on workers.dev. Rollback reaches the 100 most recent versions. ([previews](https://developers.cloudflare.com/workers/previews/), [rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/))
- Version URLs are not generated for a Worker that implements a DO, and `workers_dev: false` turns them off unless `preview_urls: true` is set. ([Version URLs](https://developers.cloudflare.com/workers/configuration/previews/))
- With Workers Cache on, every request is charged at the Workers request rate, static assets included. ([cache](https://developers.cloudflare.com/workers/cache/))

The arithmetic that separates serving files from running code ([cost.md](../cost.md), scenario B): a viral day of 100,000 visitors at 5 page views each is 500,000 page views. Served as assets, that is 0 Worker invocations. Rendered by a Worker on Free, 100,000 succeed and 400,000 fail with Error 1027, starting 1.6 to 4.8 hours into the day. About 80% of that day's visitors would see an error page.

## Decision

- Serve the site from an assets-only Worker named `ihaveasegway-web`: an `assets` directory and no `main`, so no request ever runs site code.
- Attach `ihaveasegway.com` (the apex) as a Workers Custom Domain. Redirect `www.ihaveasegway.com` to the apex with one Single Redirect rule (301) on a proxied placeholder record (AAAA `100::`).
- In `apps/web/wrangler.jsonc`, set `workers_dev: false`, `preview_urls: true`, `previews: {}`, `assets.not_found_handling: "404-page"`, `assets.html_handling: "auto-trailing-slash"` and `observability.enabled: true`. The full sketch is in [delivery.md](../delivery.md).
- Never enable Workers Cache (`cache.enabled`). CI fails if the key appears.
- Keep DO classes out of this Worker. The lab is a separate Worker ([ADR 0009](0009-lab-worker-same-origin.md)). That split is a bulkhead: the site keeps Version URLs and clean rollbacks, and a lab deploy never redeploys Home.

## Alternatives considered

- **Cloudflare Pages** (runner-up). It would work today at the same $0, on the same edge, with the same `_headers` and `_redirects` files and more mature branch deploy controls. Availability, latency and cost are the same. It trades evolvability: Cloudflare now ships new features on Workers (Previews with a DO namespace per preview, gradual deployments, Workers Logs), so a Pages site would likely migrate later, and the lab would sit on a different product in the meantime.
- **GitHub Pages, Netlify or Vercel.** Each serves static files well and would spread vendor risk. They trade operability and the lab: Durable Objects cannot run next to the site, so the lab would live on a second platform, cross-origin, with a second dashboard, credential and bill. Rejected.
- **A Worker that renders or fronts every page** (server rendering, or `run_worker_first: true`). It gives per-request control, such as headers set in code. It trades availability and cost. Every page view becomes an invocation, so on Free one shared link can spend the account's 100,000 requests within hours (the arithmetic above). Server rendering typically takes 10 to 20 ms of CPU against Free's 10 ms. On Workers Paid it is billed compute that adds nothing to a page of text. This is the weaker design the decision exists to avoid.
- **Workers Paid from day one.** A plan question, not a hosting one: see [ADR 0008](0008-workers-free-with-guardrails.md).

Prior art for this shape: Cloudflare serves developers.cloudflare.com, an Astro site, from Workers and deploys it from GitHub Actions with a Worker Preview per pull request ([cloudflare/cloudflare-docs CI](https://github.com/cloudflare/cloudflare-docs/blob/production/.github/workflows/ci.yml): pnpm 11.28.2 and Node 24.x as of 2026-10-22). Cloudflare's post ["Your frontend, backend, and database — now in one Cloudflare Worker"](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/) (2025-04-08) sets the same direction.

## Consequences

Good:

- Page views cost $0 at any volume and never touch the Worker request cap. The 100,000-visitor day above makes zero invocations.
- Every pull request gets a preview. Every deploy is a version that can be smoke-tested at its Version URL before it takes traffic, and rolled back after.
- The site and the lab share one platform and one origin, so the lab needs no CORS ([ADR 0009](0009-lab-worker-same-origin.md)).
- The output is plain files. Any static host can serve `dist/`.

Bad:

- Vendor concentration. The registrar, DNS, edge, host and lab runtime are all Cloudflare, and since 2026-01-16 so is the framework's owner ([ADR 0003](0003-astro-static-first.md)). Leaving means a registrar transfer, because [Cloudflare Registrar requires Cloudflare nameservers](https://developers.cloudflare.com/registrar/faq/). The static output keeps that exit to days, not weeks.
- That pure asset requests keep serving after the account's Free cap trips is implied by the docs, not stated. Spike S1 tests it before the lab ships ([roadmap.md](../roadmap.md)).
- `_headers` covers asset responses only. When the lab ships, its Worker must set its own headers, so headers get one source at that point ([security.md](../security.md)).
- Previews are public on workers.dev (with `noindex`), so the content firewall must run before the preview job ([ADR 0007](0007-content-firewall.md)). Whether `workers_dev: false` changes where previews publish is undocumented (spike S5).
- One key, `cache.enabled`, would turn free asset requests into billed ones. A CI check guards it.
- Workers does not infer 404 handling ([`not_found_handling` defaults to `"none"`](https://developers.cloudflare.com/workers/wrangler/configuration/#assets)), so a missing setting would serve a bare 404 instead of the site's page. Both asset keys are set explicitly, `html_handling` included even though `auto-trailing-slash` is its default, and the e2e smoke test should request a missing page and a URL without its trailing slash.

## Door

Two-way. The site is files in `dist/`. Serving them from Pages, another CDN or GitHub Pages is a change to deploy config and DNS, measured in hours; a host that does not read `_headers` and `_redirects` needs those two files translated. The one-way part is the URL scheme ([ADR 0005](0005-url-scheme.md)), and it does not depend on the host.

## Revisit if

- Spike S1 shows that static assets stop serving once the account's Free daily Worker cap trips. A busy lab could then take the site down, and the plan decision ([ADR 0008](0008-workers-free-with-guardrails.md)) changes first.
- Cloudflare starts billing asset requests, counts them toward a cap, or sets an end date for assets-only Workers.
- Spike S5 shows Worker Previews publish only with `workers_dev: true`. Production would then also answer at a workers.dev address, a duplicate of every page outside the zone's rules, much as a Pages site answers on [pages.dev](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/). Then compare the two preview models again.
