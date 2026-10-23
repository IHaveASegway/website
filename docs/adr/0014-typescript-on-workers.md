# ADR 0014: TypeScript for code that runs on Workers

Status: Proposed · 2026-10-23 · Deciders: Joseph Peterson

## Context

The lab runs on Workers. One Worker holds every Durable Object (DO) class ([ADR 0009](0009-lab-worker-same-origin.md)), and after an upgrade a cron breaker Worker joins it ([ADR 0008](0008-workers-free-with-guardrails.md)). Each demo's core (`decide`, `evolve`) runs in three places: its DO, the browser (offline mode and replay), and the tests, where recordings are golden tests ([lab.md](../lab.md)). The docs assumed TypeScript without ever deciding it. As of 2026-10-23:

- Cloudflare's first-class Workers languages are JavaScript, TypeScript, Python and Rust; Go runs only as WebAssembly ([languages](https://developers.cloudflare.com/workers/languages/)). Only JavaScript and TypeScript have a first-party DO test harness ([testing](https://developers.cloudflare.com/workers/testing/)).
- Go DOs exist only in untagged, experimental [workers-go](https://github.com/syumai/workers-go) code, which has no typed auto-response, attachments, recovery bookmarks or RPC. Native Go needs [Containers](https://developers.cloudflare.com/containers/faq/), which are Paid-only and whose cold starts "can often be in the 1-3 second range".
- [workers-rs](https://github.com/cloudflare/workers-rs) 0.8.7 has no bindings for point-in-time recovery, `ctx.abort()` or DO RPC.
- One demo core is 2.5 KB gzip as JavaScript and 1.24 MB as Go WebAssembly (go1.27.3). A Python core needs [Pyodide](https://pyodide.org/en/stable/project/roadmap.html), whose first load is a 6.4 MB download by its own roadmap page. [stack.md](../stack.md) records how the JavaScript and Go figures were measured.
- A stateless Worker on Free gets 10 ms of CPU ([limits](https://developers.cloudflare.com/workers/platform/limits/)). In spike S3 a DO handler ran about 250 ms of CPU with no limit error, and all 20 calls at that size succeeded ([roadmap.md](../roadmap.md#spikes), recorded 2026-10-23); the docs conflict on the DO limit. ADR 0008 said to plan for 10 ms until S3 answered, and its postscript of 2026-10-23 proposes 10 ms for the stateless Worker only.
- Since 2026-09-04 a Worker may be 64 MiB uncompressed on Free and Paid alike, so script size rules no language out ([changelog](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/)).

Out of scope: build and CI glue, and jobs that run outside Workers.

## Decision

- TypeScript for every Worker, every DO class and every domain core. A core has no platform imports and is handed its clock and seeded random source, so the Worker, the island and the tests all load one module.
- Another language enters only as prebuilt WebAssembly behind an interface, as the route solver does in the browser. Inside a Worker, it enters only after a workerd benchmark shows it beating the TypeScript it replaces.

## Alternatives considered

| Option | Gains | Costs | Verdict |
|---|---|---|---|
| Go in Workers (workers-go) | Evolvability: Joseph's own language | Operability: an untagged runtime, glue for three DO APIs, no RPC. Latency: about 4× slower end to end in local workerd (go1.26.0; [stack.md](../stack.md)) | Rejected |
| Go in Containers behind a TypeScript DO | Evolvability: native Go | Cost: Paid-only (ADR 0008's first trigger), and under a month-long attack only one small instance stays within budget. Latency: 1–3 s cold starts | Deferred |
| TypeScript shell, Go core as WebAssembly | Evolvability: one Go source | Latency: 1.24 MB to download before a recorded run plays. Security: `wasm-unsafe-eval` on every demo page | Rejected |
| Go server core and TypeScript browser twin, with the recordings as shared tests | Evolvability: Go on the server | Cost: about twice the domain code. Evolvability: drift is caught only where recordings reach | Rejected |
| Rust (workers-rs) | Operability: an SDK Cloudflare owns | Operability: 0.x, with two breaking releases in a year; no recovery or RPC bindings; tests stay in TypeScript | Rejected |
| Python Workers | Evolvability: first-class since 2026-09-21 | Operability: no DO test harness; open isolate bugs. Latency: 5.5 MB in the browser | Rejected |

## Consequences

- One language and one toolchain for the site, the lab and the tests. The novelty budget goes to DOs ([stack.md](../stack.md)).
- The recorded fallback loads a core of a few kilobytes, and `wasm-unsafe-eval` stays on the one page that runs WebAssembly ([security.md](../security.md)).
- TypeScript types vanish at runtime, so every frame is parsed at the boundary (ADR 0013).
- The DO test harness is young ([renamed](https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/) on 2026-08-19, eight releases since 2026-10-08), so it is pinned to an exact version.
- Workers code shows no Go. Go can still appear outside Workers, in a scheduled job written in Go that runs in GitHub Actions ("option G" in the research behind this record), if Joseph makes showing Go a goal of the site.

## Door

Two-way, with an exit cost that grows with each demo. Recordings are language-neutral NDJSON, and neither class names nor SQLite schemas depend on the language. No demo state outlives 15 minutes, and a port reads `LabControl`'s persistent flags and ledger in place. The cost is rewriting each core and each DO class. A core stays shared with the browser only if the new language compiles to small WebAssembly.

## Revisit if

- A DO handler's production `cpuTime` p99 passes 100 ms: 40% of the about 250 ms per call that spike S3 ran without a limit error, kept low because a long handler stalls everyone in its room (ADR 0008's postscript of 2026-10-23). Respond in this order: move that work to the browser with an O(n) check in the DO; profile; consider a WebAssembly kernel; then use ADR 0008's third trigger.
- Cloudflare ships a Go SDK, or workers-go tags a release with DO hosting that has typed auto-response, attachments, recovery and RPC.
- A Go core passes the golden replays and fits a lab-page JavaScript budget together with the island. design-system.md has no such budget yet; PR 6 is to propose one.
- Workers Paid arrives through another trigger, and a demo needs a long-running native process.
- workers-rs binds point-in-time recovery, `ctx.abort()` and DO RPC.
- Joseph makes showing Go a goal of the site, his question, open on 2026-10-23. Then option G comes first: write the lab's scheduled jobs in Go, in GitHub Actions, outside Workers' limits, before this record is reopened. The nightly object check already runs in Actions ([lab.md](../lab.md#observability)). A job that reconciles `LabControl`'s ledger needs a copy of the ledger it can read from outside the Worker first, such as Analytics Engine, which is an open question for PR 6.
