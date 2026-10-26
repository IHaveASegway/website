# ADR 0018: The page policy is a header the build writes

Status: Proposed · 2026-10-25 · Deciders: Joseph Peterson

## Context

Until this record the page's Content Security Policy was Astro's: `security.csp` in `astro.config.mjs`, written into each page as a `<meta http-equiv="content-security-policy">` with a SHA-256 hash for each inline script and style ([security.md](../security.md#headers-and-content-security-policy)). Two things followed from the `<meta>`:

- **It governed only what came after it.** Astro writes the `<meta>` at the end of `<head>`. The pre-paint theme script has to run in `<head>`, ahead of the stylesheets, or a frame paints with the wrong theme (seen on the first Worker Preview), so it ran before the policy and was not governed by it. Two checks pinned the exception: `test/csp.test.ts` allowed exactly that script there, byte for byte, and an e2e test required a tampered copy placed after the policy to be refused.
- **`frame-ancestors` lived apart.** A `<meta>` cannot carry it, nor Report-Only or a reporting endpoint ([CSP Level 3](https://www.w3.org/TR/CSP3/)), so `public/_headers` sent `frame-ancestors 'none'` as a second, header policy on every response.

security.md recorded a header policy built from the same hashes as "the end state; not yet", to be revisited in PR 3b, which planned the first third-party origin (the Web Analytics beacon), or when anything else needed to run before the `<meta>`. The roadmap's PR 3b asks for the revisit. Measured on the build of 2026-10-25, every page's policy was the same but the Route Lab's, which adds `worker-src 'self'` ([ADR 0016](0016-route-lab-in-the-browser.md)).

## Decision

The build writes the page policy into `dist/_headers`, and Astro writes no `<meta>`.

- **One module owns the policy**, `apps/web/src/lib/csp.mjs`: the site's directives (`default-src`, `img-src`, `font-src`, `connect-src` and `form-action` `'self'`; `object-src`, `base-uri` and `frame-ancestors` `'none'`), the directives a page adds by its path (`worker-src 'self'` on `/lab/routes/`), and `script-src` and `style-src` with `'self'` and a hash of each inline script and `<style>` the page holds. It reads the built page with parse5, as the browser parses it: a `<script>` with no `src` and a type that runs as script, or a `<style>`, an SVG's and a `<template>`'s included. A data block such as JSON-LD is not script, and gets no hash.
- **`astro.config.mjs` runs it once the pages are written** (`astro:build:done`), after the `X-Build` header, on every build: `dist/`, `dist-preview/` and the test fixtures. `security.csp` is off, so the two policies never both apply.
- **The 404's policy goes on the `/*` rule**, which every response matches, so a path no page has, answered with the 404 page, gets that page's own policy; under the solver's folder, which detaches it (below), a missing file's 404 gets the solver's. A page whose policy differs, today only the Route Lab's, gets a rule of its own that detaches the shared one first (`! Content-Security-Policy`). The step refuses to run if `public/_headers` already sends a policy on `/*`.
- **The solver's folder detaches the page policy too.** Its files match `/*`, and two policies on one response are both enforced; the page's has no `'wasm-unsafe-eval'` and would refuse the worker's compile. So `/lab/routes/solver/*` drops the page policy before sending its own. Its own gains `base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, the three directives `default-src` does not cover: a worker ignores them, and every response, a 404 under the folder included, stays as unframeable as it was when `_headers` sent `frame-ancestors` beside it.
- **The theme script is governed.** It keeps its place in `<head>`; the header applies before the first byte of markup.
- **The build refuses what the asset server would read otherwise.** Cloudflare's parser (workers-shared, which `wrangler dev` and a deploy both run) skips a line longer than 2,000 characters and every rule past the hundredth, each with only a warning, and keeps only the last rule for a path. A dropped policy line would leave a page with its detach and no policy at all. So `withPagePolicies` throws on a line or a rule count past those limits, a second `/*` rule or one whose line holds more than `/*`, a rule for a page path the file already holds, a rule for a host (a line such as `https://example.com/*` opens a rule too, which the checks do not resolve), and a `/*` rule that already sends a policy, reading the file as that parser does. The longest line is about 400 characters on 2026-10-25. A page that is not `<path>/index.html` or the root 404 stops the build too, since no rule would name the path it is served at.
- **A directive is written once.** A browser enforces the first copy of a repeated directive. So where `DIRECTIVES` and a page's `PAGE_DIRECTIVES` both name one, `policyFor` writes it once with both lists' sources: the Web Analytics beacon's origin in a site `script-src` entry and Turnstile's in a lab page's both land in that page's one `script-src`, after `'self'` and before the hashes. `'none'` joins no other source, since beside one it means nothing and the source would win, so a repeat with `'none'` on either side throws. The checks refuse a repeated directive in a served policy too.

Cloudflare's asset server and `wrangler dev` both apply every matching rule in order, a rule's `! Name` lines before its headers; `wrangler dev` was checked on 2026-10-25, and e2e checks the deployed preview on every pull request.

### What checks it

- `test/csp.test.ts`, on every build: no page carries a `<meta>` policy; every inline `<style>` is the Fonts API's, an allowlist beside the scripts' (`test/scripts.test.ts`), since the policy now hashes any style the build finds; the header the build's `_headers` sends for each page's path, resolved as the server resolves it (`test/support/headers.ts`), is exactly the policy the page's own inline code needs; the directive set is the one above, written out in the test rather than imported; the theme script is the first script, in `<head>`, byte for byte the file; and known answers on the module, among them a page whose policy differs getting its own rule, and a `/*` rule that already sends a policy refused.
- `test/headers-rules.test.ts`: `public/_headers` sends no page policy; the solver's rule detaches it before its own; in the build's file the solver resolves to its own policy alone, every other path to one page policy, and every path, the solver's 404 included, refuses to be framed; with known answers, a rule without the detach resolves to two, `!Name` without the space detaches nothing, and a path defined twice keeps its last rule.
- `e2e/csp.spec.ts`, against the preview: no violation on any page; an injected inline script refused; and a copy of the theme script with one byte changed, placed first in `<head>`, refused. Under the `<meta>` that copy would have run.
- `e2e/headers.spec.ts`, `e2e/prod.spec.ts` and `e2e/writing.spec.ts`: one policy of the build's shape on a page, an asset and the 404, and the solver's own policy alone on its files. A build from before this record, which a rollback can serve, passes with `frame-ancestors` alone beside its pages' `<meta>`.

## Alternatives considered

| Option | Verdict |
|---|---|
| **A header the build writes from each page's inline code (chosen)** | Chosen: it governs every script on the page, keeps one policy per response, and needs no Worker on a page view |
| Keep Astro's `<meta>` | Rejected now: the theme script stays ungoverned, and the policy stays split between two owners. It was the right trade in PR 3, with the exception pinned |
| Move the theme script after the `<meta>` | Rejected: a frame can paint with the wrong theme when the HTML arrives in pieces, as the first Worker Preview showed |
| One hand-kept header policy | Rejected: a static file cannot track the hashes, so it needs `'unsafe-inline'`, and any injected inline script runs |
| A nonce minted per request | Rejected: a Worker on every page view, against the Free plan's daily cap ([ADR 0008](0008-workers-free-with-guardrails.md)) |
| Both, the `<meta>` and the header | Rejected: two owners of the same directives, each only restricting the other ([security.md](../security.md#headers-and-content-security-policy), "one owner per directive") |

## Consequences

- The theme script's exception is gone, and with it the check that allowed it. `frame-ancestors` joins the page policy.
- The policy shrinks to what the pages hold: Astro's 5 unused `script-src` hashes and its 1 `style-src` hash are gone, leaving 1 and 2.
- The build owns about 200 lines of policy code, with known answers, where Astro's config held 20. A page that adds inline code gets its hash without an edit; a page that needs a new directive gets a line in `PAGE_DIRECTIVES`.
- Every response but the solver's files and the hashed bundles carries the page policy, files as well as pages; an image or a feed ignores it. The bundles under `/_astro/`, scripts, stylesheets and fonts, which are never a document or a worker, carry none, nor `Permissions-Policy` or `Cross-Origin-Opener-Policy`, since 2026-10-25: about 570 B of header each, on every page view, which Lighthouse counts in a page's transfer and which took the Route Lab's page past its 150 KB once the command menu added a bundle ([security.md](../security.md#headers-and-content-security-policy)).
- Violation reports become possible, since a header can name an endpoint. None is collected yet.
- A page with a policy of its own costs a `_headers` rule, and the asset server allows 100. Every page shares the 404's policy today but the Route Lab's.

## Door

Two-way. Reverting turns `security.csp` back on and takes the step out of the config; the tests say which version is live.

## Revisit if

- Astro writes per-page hashes into headers for static output itself, which would retire the step.
- Pages stop sharing a policy, so that the rules approach the asset server's limit of 100.
- The Web Analytics beacon ships: its origin joins `DIRECTIVES` as a `script-src` entry, which `policyFor` merges into the one `script-src`, and the request watcher, as security.md plans.
- Cloudflare changes how `_headers` joins or detaches a header. e2e on the preview would show it.
