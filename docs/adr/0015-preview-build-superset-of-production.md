# ADR 0015: A preview build holds the production build, byte for byte

Status: Proposed · 2026-10-23 · Deciders: Joseph Peterson

## Context

Since PR 5, each commit is built twice ([content.md](../content.md), "Drafts"):

- `pnpm build` writes `dist/` with `DRAFTS=exclude`. It is the build `main` deploys.
- `pnpm build:preview` writes `dist-preview/` with `DRAFTS=include`. A pull request's preview serves it, so a draft can be read where it will be published, after the firewall job has scanned it.

A pull request's `e2e` job runs on that preview: axe, the policy, the headers, the glyph and held-name checks and the smoke all read `dist-preview/`. Nothing in a pull request runs a browser against `dist/`. After the merge, the deploy job smokes `dist/` on its Version URL over HTTP, and no browser check runs before it takes traffic ([delivery.md](../delivery.md), "Deploy, verify, roll back"). So what `e2e` proves holds for the bytes that ship only if `dist/`'s files are in `dist-preview/`, unchanged. Until this record, that was a premise. Nothing checked it.

Building twice breaks a pipeline rule this repository otherwise follows: build once, and promote the same artifact ([ADR 0006](0006-github-actions-owns-deploys.md); Humble and Farley, *Continuous Delivery*, 2010, chapter 5, "Only Build Your Binaries Once"). Static site generators commonly do it anyway. Hugo has `--buildDrafts`, and Netlify's announcement of deploy contexts uses exactly this as its example: `[context.deploy-preview] command = "hugo --buildDrafts --buildFuture"`, overriding the build command and nothing else ([Netlify, 2016](https://www.netlify.com/blog/2016/08/30/introducing-deploy-contexts-in-netlify)). The pattern is common. A check that the two builds agree is not part of it.

Two builds of one commit read the clock at different moments. The build's day (`builtOn`, in Home's readout and in the footer's build line) and the copyright year are the only values that do. In CI the second build costs 2 to 4 seconds (verify step times, 2026-10-23).

## Decision

Keep two builds, and hold them to a contract: for the same commit, every file in `dist/` exists in `dist-preview/` with the same bytes. The one exception is the build's day and the year, each matched only in its exact context. `dist-preview/` may only add pages: drafts, and, below 3 published posts, the published posts as unlisted pages. Every added page is `noindex`.

Three checks hold the contract:

- **`test/superset.test.ts`, in `verify`.** It compares `dist/` with `dist-preview/`, and each fixture build with its preview (`fixture-two`, `fixture-three` and `fixture-many`, with and without drafts). Its known answers: a missing file, a page that lists a draft, a post whose date differs, or a binary that differs is named; two builds either side of midnight pass.
- **`test/urls.test.ts`, in `verify`.** It holds "every added page is `noindex`": on each build a Vitest project reads, `dist-preview/` and two fixture previews among them, the pages that are not `noindex` are exactly the published-URL ledger, or the fixture's page list, so a page a preview adds without `noindex` fails there. The byte comparison alone would not see it.
- **`scripts/deploy-guard.mjs`, in `deploy`.** It covers the other direction: nothing only a preview may hold ships. It refuses an artifact with any `noindex` page but the 404, whichever build it came from ([delivery.md](../delivery.md)).

A design rule follows from the contract: drafts may add pages, and never change a page production also builds. A preview banner, or a draft listed on Home in previews, breaks it, and verify names the file.

## Alternatives considered

| Option | What `e2e` tests | Drafts readable on a preview | Cost | Door |
|---|---|---|---|---|
| **A. Two builds, held to a byte-for-byte superset (chosen)** | `dist/` through the contract, plus the drafts | Yes | One more build, 2 to 4 seconds; one test file | Two-way |
| B. One build, without drafts: the preview serves `dist/` | `dist/` itself | No: a draft is read in `astro dev` only, on the laptop, before the firewall scans it rendered | None | Two-way |
| C. One build, with drafts, hidden in production by a Worker that answers 404 for draft paths | The bytes that ship, drafts included | Yes | Runtime code on every page view in an assets-only Worker ([ADR 0002](0002-host-on-workers-static-assets.md), [ADR 0003](0003-astro-static-first.md)); a failed gate publishes drafts | Two-way, but every request pays for it |
| D. Two builds, and `e2e` on both: the preview, and `wrangler dev` serving `dist/` | Both, directly | Yes | The site suite once more, on `wrangler dev`: 28 to 37 seconds, at most 1 more billed minute per pull request push, and `wrangler dev` is not the edge ([delivery.md](../delivery.md), "Dependabot PRs") | Two-way |

In quality attributes: A trades a little evolvability (a page production builds cannot vary in previews) for test coverage at almost no cost. B is the simplest, but it moves draft review off the reviewed preview. C fails the static-first decision and turns a build-time guarantee into a runtime one. D buys direct coverage cheaply, at most one billed minute a push, about 40 to 65 a month, but its extra run is a local server rather than the edge; A gets the same assurance from a byte comparison that costs seconds, and pays with the design rule above.

## Consequences

- The `e2e` results on a preview stand for `dist/`. The contract is checked on every pull request instead of assumed.
- Drafts can never change a page production builds. If a shared page ever has to differ in previews, the contract has to change first (see Revisit if).
- The deploy guard, the sitemap filter and the URL checks share one definition of `noindex` (`src/lib/noindex.mjs`), the bytes `Base.astro` writes, so the writer and the checks that read the tag cannot disagree. The superset test compares bytes and needs no definition of its own.
- The clock exceptions are narrow: a date anywhere else, a post's `published` for instance, is compared byte for byte.

## Door

Two-way. The contract is a test. Dropping it means deleting the test and accepting that `e2e` stops vouching for `dist/`. The design it allows, drafts readable on previews, is the harder part to undo, because draft review would move back to the laptop.

## Revisit if

- A feature needs a page production builds to differ in previews, such as a preview banner on every page. Then run `e2e` on `dist/` as well (option D), or move the banner outside the build, for example into a header the preview Worker adds.
- Drafts move out of the repository, into a CMS with a preview mode. Then one build could serve both, and option B or C becomes cheaper.
- The superset test fails on a change nobody meant to make a preview differ. That is the contract working; if it happens more than twice a quarter, the builds have drifted apart in design, and this record should be reopened.
