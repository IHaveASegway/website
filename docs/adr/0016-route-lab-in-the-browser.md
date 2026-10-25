# ADR 0016: The Route Lab runs VROOM in the visitor's browser, from static files

Status: Proposed · 2026-10-25 · Deciders: Joseph Peterson

## Context

[lab.md](../lab.md) designed the Route Lab as the last demo to ship: a `RouteRoom` Durable Object behind the lab Worker ([ADR 0009](0009-lab-worker-same-origin.md)), a WebAssembly solver from reinterpretcat/vrp, which calls itself experimental, a uint16 travel-time matrix in the lab Worker for checking plans, and rooms where visitors race to improve one plan. It waited on the whole Phase 4 platform: Turnstile, the session cookie, `LabControl`'s budgets, recordings and the kill switch.

On 2026-10-25 Joseph directed the work: the goal is VROOM running, dressed as isochrones, with demo routes that are fun and easy to understand, maps in the Washington State area, and a decision on cost. VROOM is the open-source vehicle routing solver in C++ (BSD-2-Clause). It has no browser build: its interfaces are a CLI, an HTTP server, Python bindings and a Docker image, and its issue #690 ("wasm") closed in 2022 with no port.

Two spikes on 2026-10-24 and 2026-10-25 settled what the design rests on, with their evidence in `tools/`:

- **VROOM compiles to WebAssembly with three small patches** (`tools/vroom-wasm/`). Its answers are byte for byte those of a native clang/libc++ build on 46 cases, and those of the upstream g++ build except the order of one unordered list. `vroom.wasm` is 919,927 B, 343,650 B gzip -9, and its glue has no `eval`. In headless Chromium, 20 orders and 3 vans plan in about 60 ms, and every one of the 63 orders with 4 vans in about 320 ms (2026-10-25, 4 CPUs).
- **The map data precomputes offline** (`tools/route-data/`): OSRM's car profile over OpenStreetMap gives the travel times for every pair of 64 places, 4,032 legs, and their road geometry, and the isochrones and a basemap come from the same extract. The three files are 93.4 KB gzip together.
- **A worker takes its Content Security Policy from its own response.** Measured in Chromium through `wrangler dev`: a module worker compiles WebAssembly when its own response allows `'wasm-unsafe-eval'`, whatever the page's policy says, and fails when it does not. That is what the HTML standard says for a dedicated worker loaded from a URL.

So the expensive part, the solve, can run where it is free, in the visitor's browser, and the server has nothing to check, because nothing is shared.

## Decision

The Route Lab is a static demo at `/lab/routes/`, with `/lab/` as its index:

- **The solver is VROOM 1.15.0, compiled to WebAssembly** with Emscripten 6.0.13 (`-O3`, one thread, matrices only), and run in a module Web Worker. Its four files and one licence file sit in `/lab/routes/solver/vroom-<version>-<sha8>/`, a folder named for the solver's version and a hash of all five files, the licences included, since the folder is cached as immutable for a year; `apps/web/src/lib/route-lab/solver.lock.json` pins every byte. `tools/vroom-wasm/` holds the build, the patches, the tests that compare it with native VROOM, and the install step.
- **The data is precomputed** from OpenStreetMap (© OpenStreetMap contributors, ODbL) by `tools/route-data/`, and its outputs are committed there. The page draws the basemap and the isochrones inline and fetches the route data on first use. The places are public parks, gardens, beaches, viewpoints, libraries, markets and landmarks in and around Seattle; the bakery and every order are made up.
- **Nothing runs on a server.** No lab Worker, no Durable Object, no Turnstile, no cookie, no recording. A page view and a solve make zero Worker invocations, so the demo costs $0 to run, on the Free plan or any other.
- **The page is complete without JavaScript.** The build runs the same `vroom.wasm` in Node and draws a busy Saturday's two plans, the orders as they came in and VROOM's, with their figures and tables. No figure on the page is typed.
- **A domain core, `lib/route-lab/`**, plain TypeScript with no DOM or platform import, runs in the build, the browser and the tests: the leg decoder, the dealt-in-turn plan, VROOM's input and output, the measures and the markup.

Six of the site's rules change, each for this demo only, each with a test that names the change and a known answer that fails if it reaches another page:

| Rule | Before | After | Test |
|---|---|---|---|
| Content Security Policy | `script-src` is Astro's `<meta>`, and `_headers` sends `frame-ancestors` only | `_headers` gives `/lab/routes/solver/*` its own policy, `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`, the one `script-src` a header sends and the one place the keyword appears. `/lab/routes/`'s `<meta>` adds `worker-src 'self'`, and no page's policy may hold `'wasm-unsafe-eval'` | `test/headers-rules.test.ts`, `test/csp.test.ts`, `e2e/headers.spec.ts`, `e2e/lab.spec.ts` |
| Scripts on a page | the theme script and JSON-LD | and, on `/lab/routes/` only, one module from `/_astro/`, the Route Lab's bundle | `test/scripts.test.ts` |
| Budgets | lazy JavaScript ≤ 2,000 B per feature | the Route Lab's lazy JavaScript ≤ 12,000 B in all (measured 8,565 B; 10,031 B after the reviews), its WebAssembly ≤ 360,000 B (343,650 B), its route data ≤ 60,000 B (56,049 B), its page's first view ≤ 150,000 B (136,520 B; 137,284 B with the résumé's header link and rules; 141,073 B after the reviews) and the first view with one solve ≤ 600,000 B (544,784 B; 545,548 B; 550,803 B), all gzip -9. The eager budget, 5,000 B, holds on its page too (1,930 B; 1,990 B) | `test/budgets.test.ts` |
| Binaries in `dist/` | PNG, ICO, WOFF2 | and WebAssembly, with its own check: the lock, no custom section, the imports and exports, its strings, and a golden solve | `test/dist-files.test.ts`, `test/wasm.test.ts` |
| Held-name and URL scans | every text file read as markup | a `.js` or `.mjs` file read as JavaScript, in four views: as written; with its string escapes decoded; and as the markup it may write through `innerHTML`, references decoded, with and without its tags. In those two views a `&` that starts no reference stays as written: minified code is full of `&&name`, which the markup reading refused as unreadable. No view is lost: every spelling the markup reading catches, the script reading catches too, with known answers for a name split by tags, behind a reference or behind an escape | `test/not-on-site.test.ts`, `test/readiness.test.ts` |
| Colors | the semantic tokens | and map tokens: water, parks, six isochrone bands, four van colors, places, the bakery, the 10 and 20 minute lines, labels, with the cross product checked like the rest: every mark 3:1 and every label 4.5:1 on every map fill; a stop's number, the page's background on its van's color, 4.5:1; each band 0.045 or more in OKLab from its neighbour and from the water; and the two vans that share a stop's shape 20 or more apart in CIEDE2000 under protanopia, deuteranopia and tritanopia. In light, the vans are darker than the accent, so the bands can span more lightness | `test/tokens.test.ts` |

Two more checks moved with the page, without loosening: the keyboard-focus check counts a radio group as one Tab stop, as browsers do, and the motion check on stylesheets expects the Route Lab's sheet to ship exactly one guarded fade.

### Changed before acceptance, after three reviews (2026-10-25)

A visitor's review, a security and performance review and an accessibility review of the first build changed how the page behaves, inside the rules above; no rule was loosened for it:

- **Every change plans again, by itself.** The button is gone: 150 ms after the last change, VROOM plans the orders on show. One solve runs at a time; changes made during it are planned once it answers, as one; a solve with no answer in 15 s stops the worker and the page says the solver could not run. Ten quick changes cost at most three solves, where ten presses had queued ten.
- **The solver loads only when there is something to plan.** The app and the route data, about 60 KB, load on a focus inside the demo, a mouse over it, or a change; the worker and its WebAssembly on the first solve. A touch that only scrolls the page loads nothing, where any touch had loaded about 408 KB.
- **The page says what happened.** One status region says each change, what VROOM saved, when the last van is back in each plan, and how long the solve took. Each map numbers its stops up to 30, and a mouse over a place shows its name, its order, its stop and its drive time from the bakery.
- **The bands read.** They step further in lightness and in hue, a dotted line marks where 10 and 20 minutes end on land, with labels, and the list of places and the tables give each place's drive time from the bakery as text.
- **On a phone, one map at a time**, with a choice of which, so the two compare in one place; the days are one row that scrolls inside itself, and the stop tables fold away.
- **The link preview shows the demo.** The page's card carries the busy Saturday as VROOM plans it, drawn at build with no word in it, beside its title and label ([content.md](../content.md), "Structured data and link previews").

## Alternatives considered

| Option | Cost to run | What a visitor waits for | Fidelity to "VROOM running" | Door |
|---|---|---|---|---|
| **A. VROOM in WebAssembly in the browser, static data (chosen)** | $0 | 252 KB brotli of solver on first use; then 10 to 400 ms a solve | VROOM itself | Two-way |
| B. lab.md's design: reinterpretcat/vrp in WebAssembly, rooms in a Durable Object | Free-plan quota per session; the Phase 4 platform first | The same, plus Turnstile | Not VROOM | Two-way |
| C. A JavaScript heuristic written for the page | $0 | Least bytes | A re-implementation, not VROOM | Two-way |
| D. Native VROOM in a Container | Paid plan only; about $185 per 72 hours under abuse ([cost.md](../cost.md), scenario E) | A cold start of 1 to 3 s | VROOM | Two-way, but it fires ADR 0008's upgrade trigger |
| E. A hosted VROOM or OSRM API | A third party's quota or bill | A network round trip | VROOM, elsewhere | Two-way, but a third-party origin joins the policy and visitors' choices leave the site |
| F. Live routing with OSRM in a Worker | Quota per request; OSRM's graph is 215 MB | A round trip | VROOM still needs a host | Two-way |

A is the only option that runs VROOM itself at no cost and with no third party. It pays in bytes, a browser floor and a second owner for one policy; B pays in quota and platform work, and C fails the brief.

## Consequences

- **$0 at runtime.** The demo's files are static assets, which invoke no Worker and count toward no daily cap ([ADR 0002](0002-host-on-workers-static-assets.md), [ADR 0008](0008-workers-free-with-guardrails.md)). The Route Lab leaves the lab platform's ship order: it needs none of PR 6.
- **About 0.9 MB of binary in the repository** per solver version, and 290 KB of map data. A new solver version is a new folder, so its URL changes with its bytes.
- **Upkeep Dependabot cannot see:** a quarterly check of VROOM and Emscripten releases, and a yearly refresh of the OpenStreetMap extract ([operations.md](../operations.md)).
- **ODbL obligations:** the attribution next to the map, linked to the copyright page, and the pipeline committed as the method that made the derived data.
- **A browser floor.** The module uses WebAssembly exception handling and bulk memory: Chrome 95, Firefox 100, Safari 15.2 or later by the webassembly.org feature table, and module workers and `'wasm-unsafe-eval'` add their own. Below it, or with the worker blocked, the page keeps the plan worked out at build and says the browser could not run the solver.
- **A second owner for a policy, scoped to worker scripts.** `_headers` owns the worker's policy and Astro's `<meta>` owns the page's ([security.md](../security.md)). A worker is its own context, so "one owner per directive" still holds within each.
- **Every page carries the map tokens**, 317 B gzip of CSS, because `tokens.css` is the only file that may hold a color. Home measured 6,249 B of CSS against 5,932 B before, inside the 15,000 B budget; 6,984 B with the résumé's rules as well; 7,017 B with the contour token and the reviewed map colors.
- **What only Joseph can clear before merge is unchanged by this record** (product.md, Q13; lab.md, "Rules for every demo"): the invention-assignment check; the Seattle region, which lab.md makes an ASK review; the five markets among the places, which are run by organizations; reading the demo beside his résumé; the credit line for work built with agents; and the review stamp on `src/content/lab/routes.md`, which keeps the pull request red until he reads the entry.

## Door

Two-way for the solver, the page, the data and the budgets: they are static files and configuration, and each rule change is a test that can be reverted with them. One-way for the URLs `/lab/` and `/lab/routes/` once shared ([ADR 0005](0005-url-scheme.md)), and nearly one-way for the published map region and data, because copies persist.

## Revisit if

- A VROOM or Emscripten update takes the WebAssembly past 360,000 B gzip, or the lazy JavaScript past 12,000 B.
- Any browser engine applies the page's policy to a dedicated worker. Then the page needs `'wasm-unsafe-eval'` too, and that is a new decision, not an edit here.
- The largest day takes more than 2 s to plan on Joseph's phone.
- A multiplayer version is wanted, where visitors race on one plan. That is the lab Worker of ADR 0009, and the browser solver becomes its client.
- The OpenStreetMap extract is more than 12 months old.
