# Architecture decision records

One file per decision that is hard to reverse. Format after Michael Nygard, "Documenting Architecture Decisions" (2011), plus two fields: **Door** (one-way or two-way, and why) and **Revisit if** (the evidence that would show the decision was wrong). ADRs are written to be public-safe because the repository may become public, and sensitive inputs (such as the firewall terms) never appear in them.

Status: Draft for review in PR 1 · 2026-10-22

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-host-on-workers-static-assets.md) | Host on Workers static assets, not Pages | Accepted |
| [0003](0003-astro-static-first.md) | Astro, static-first, zero JavaScript by default | Accepted |
| [0004](0004-content-as-code.md) | Content lives in the repo; LinkedIn owns employment history | Accepted |
| [0005](0005-url-scheme.md) | URL scheme with trailing slashes | Accepted |
| [0006](0006-github-actions-owns-deploys.md) | GitHub Actions owns build, gates and deploys | Accepted |
| [0007](0007-content-firewall.md) | Content firewall: secret-held rules, fail closed | Accepted |
| [0008](0008-workers-free-with-guardrails.md) | Workers Free with spend guardrails and upgrade triggers | Accepted |
| [0009](0009-lab-worker-same-origin.md) | One lab Worker for all Durable Objects, on `/lab/api/*` | Proposed |
| [0010](0010-quiet-console-design-tokens.md) | Direction C's tokens, owned here and copied rather than imported | Accepted |
| [0011](0011-dnssec-and-hsts-ramp.md) | DNSSEC now; HSTS ramped; no preload yet | Accepted |
| [0012](0012-public-repository.md) | Public repository after the firewall audit | Proposed |
| [0014](0014-typescript-on-workers.md) | TypeScript for code that runs on Workers | Proposed |
| [0015](0015-preview-build-superset-of-production.md) | A preview build holds the production build, byte for byte | Proposed |
| [0016](0016-route-lab-in-the-browser.md) | The Route Lab runs VROOM in the visitor's browser, from static files | Proposed |
| [0017](0017-firewall-reads-webassembly.md) | The firewall reads WebAssembly | Proposed |
| [0018](0018-page-policy-as-a-header.md) | The page policy is a header the build writes | Proposed |
| [0019](0019-space-time-cube-in-webgl.md) | Interactive 3D where it shows the work: the Route Lab's space-time cube in WebGL | Proposed |
| [0020](0020-raft-lab-deterministic-simulation.md) | The Raft Lab is a deterministic simulation in the browser, with its own Raft and a safety checker | Proposed |
| [0021](0021-rail-and-living-ground.md) | A rail for the navigation from 80rem, and Home's contour drawing alive on the GPU | Proposed |
| [0022](0022-rail-as-index-and-row-links.md) | The rail as an index of the site, with search; a row of an index is its link | Proposed |
| [0023](0023-home-as-a-story-and-rail-drop-downs.md) | Home told as a story, with isometric pictures drawn at build; the rail's items drop down | Proposed |
| [0024](0024-home-led-by-the-work.md) | Home led by the work: the Route Lab's day live behind the name, the Raft Lab's election, a bolder type | Proposed |
| [0025](0025-signal-box-identity.md) | The site's identity is a signal box: a line per lab, lamps for state, Barlow and B612 Mono, Seattle on the water | Proposed |
| [0026](0026-three-more-labs-simulated-in-the-browser.md) | The Queue, Cache and Backfill Labs are deterministic simulations in the browser, on one shared kernel | Proposed |
| [0027](0027-design-follows-josephs-references.md) | The site's design follows Joseph's references: a light technical drawing, a top bar, his system drawn isometrically | Proposed; superseded in part by 0028 |
| [0028](0028-home-is-his-own.md) | Home is his own: his words as the statement, his Raft cluster live beside them, what he builds with the labs as its evidence | Proposed |

0013 is reserved for protocol v1 and the recording format, written in PR 6 ([roadmap.md](../roadmap.md#pr-6-lab-platform-and-presence)).

0027, proposed on 2026-10-31, supersedes 0025 in part (its palette, faces, rail and chrome), 0024 (Home's composition) and 0023 (the rail's drop-downs), and amends 0021 and 0022; the plan for builders is [docs/design/overhaul.md](../design/overhaul.md).

0028, proposed on 2026-11-01, supersedes 0027's Home, which had taken a reference's composition with new assets; the page's design is [docs/design/home.md](../design/home.md).

0025, proposed on 2026-10-30, supersedes 0010 in part: its palette and its faces. 0010's ownership of the tokens, the copy rather than the import, and the contrast test stand, so 0010 stays Accepted, with a postscript that says so.

How an ADR is proposed, accepted, superseded and later rendered on the site is itself a decision: [ADR 0001](0001-record-architecture-decisions.md).

Open decisions that have not reached an ADR yet are listed in [product.md](../product.md#open-decisions).

## Template

```
# ADR NNNN: <decision>

Status: Proposed | Accepted | Superseded by NNNN · <date> · Deciders: <names>

## Context
## Decision
## Alternatives considered
## Consequences
## Door
## Revisit if
```

## Patterns and further reading

- Architecture decision records: Michael Nygard, ["Documenting Architecture Decisions"](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (2011).
- One-way and two-way doors: Jeff Bezos, [2015 letter to Amazon shareholders](https://s2.q4cdn.com/299287126/files/doc_financials/annual/2015-Letter-to-Shareholders.PDF) (Type 1 and Type 2 decisions).
- MADR, the main alternative format, and why it is not used here: [ADR 0001](0001-record-architecture-decisions.md). Every other source: [reading-list.md](../reading-list.md).
