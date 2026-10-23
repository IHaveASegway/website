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
