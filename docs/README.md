# ihaveasegway.com docs

This folder is the plan and the decision record for ihaveasegway.com, Joseph Peterson's personal site. It says what the site is for, how it is built, shipped, secured, paid for and run, and why each choice beat its alternatives. It is also a study guide: every decision names its pattern, the quality attributes it trades, whether it is a one-way or a two-way door, and a source to read next.

Status: Draft for review in PR 1 · 2026-10-22

PR 1 is docs only: no code, no workflow, nothing deployed. Every ADR in [adr/](adr/README.md) is Proposed until Joseph accepts it in review. Until then nothing here is a commitment, and every recommendation is open to argument.

## Start here in 10 minutes

1. [product.md](product.md): read **Why** and **Open decisions** (5 minutes). The questions that blocked PR 2 and PR 3 were answered on 2026-10-22 ([Decided](product.md#decided)); the rest are listed by the pull request they block.
2. [architecture.md](architecture.md): the diagrams only (2 minutes).
3. [roadmap.md](roadmap.md): the phases, what each PR ships, and what blocks it (3 minutes).

Then answer the open decisions in the PR review, with the option letter. Anything the firewall touches goes in the private record instead ([product.md](product.md#content-firewall)), because reviews and comments go public with the repository. Every other doc can wait until the PR it serves comes up.

## Reading order

product → architecture → stack → content → design-system → lab → delivery → security → cost → operations → roadmap → adr/ → reading-list

Purpose first, then the shape, then the parts, then how the parts ship, stay safe, cost and run, then the plan that schedules them. The ADRs come after the docs because each one argues a single decision the docs have already put in context. The reading list is for afterwards.

## Files

| # | File | What it answers |
|---|---|---|
| 1 | [product.md](product.md) | Why build it, for whom, and what is still undecided? Principles, the content firewall policy, milestones, open decisions Q1–Q29, non-goals, how we will know it works, glossary |
| 2 | [architecture.md](architecture.md) | What is the shape? Context and container diagrams, bounded contexts, who owns each piece of data, request flows, bulkheads and failure modes |
| 3 | [stack.md](stack.md) | Which technologies, pinned how, and why? What each owns, what came second, what was rejected, the upgrade policy |
| 4 | [content.md](content.md) | What is on the site? Sitemap, URL scheme summary, Home sections, the case-study template, content model, voice, firewall classes for copy, writing plan |
| 5 | [design-system.md](design-system.md) | What does it look like? The Quiet Console design language: tokens, contrast, type, motifs, motion, effects, budgets, accessibility rules, wireframes |
| 6 | [lab.md](lab.md) | How do the live demos work? Durable Objects topology, admission and guardrails, kill switch, recorded fallbacks, protocol v1, the ranked demo backlog |
| 7 | [delivery.md](delivery.md) | How does a change reach production? Repo layout, toolchain pins, the CI/CD job graph, environments, deploy and rollback, quality gates, dependency policy |
| 8 | [security.md](security.md) | What could go wrong, and what stops it? Threat model, headers and CSP, zone hardening, mail, secrets, the content firewall design, supply chain, privacy |
| 9 | [cost.md](cost.md) | What does it cost, and what keeps it there? Price sheet, formulas, scenarios, Free versus Paid, guardrails, upgrade triggers, annual totals |
| 10 | [operations.md](operations.md) | How is it run alone? Access setup, observability, alerting, runbooks, the maintenance calendar |
| 11 | [roadmap.md](roadmap.md) | In what order? Phases and PRs with scope, definition of done, estimates and blockers; spikes S1–S9; the WIP limit |
| 12 | [adr/README.md](adr/README.md) | Which decisions are hard to reverse? The ADR format and the index of ADRs 0001–0012 |
| 13 | [reading-list.md](reading-list.md) | Where do I learn more? Every pattern named in these docs, with one canonical source and why it is worth the time |

This table lists docs, not ADRs. The ADR index is the one owner of ADR titles and statuses. Copying it here would give the same facts two owners, the drift this plan avoids everywhere else (principle 3 in product.md).

## Status legend

| Status | Used on | Meaning | What may change |
|---|---|---|---|
| Draft for review | Docs (the line under each title) | Written for PR 1 and under review | Anything, in a PR |
| Proposed | ADRs | Argued, not yet accepted. Every ADR starts here | The decision itself, in a PR |
| Accepted | ADRs | Joseph accepted it in review; the Status line carries the date | Typo fixes and dated postscripts only. A changed decision gets a new ADR |
| Superseded by NNNN | ADRs | Replaced by a later ADR, which links back | Nothing. It stays as the record of what was believed, and why |

## How to change a decision

The ADR lifecycle (proposing, accepting, superseding, rendering on the site) is itself a decision, [ADR 0001](adr/0001-record-architecture-decisions.md). This is the short version.

- **A doc.** Edit it in a PR. Each topic has one owning doc (the table above), and other docs link to it rather than repeat it. Change the owner, not a copy.
- **A Proposed ADR.** Edit it in a PR. Nothing is built on it yet, so rewriting it is cheap.
- **An Accepted ADR.** Leave the decision as written. To change it, write a new ADR with the next number, explain in its Context what changed, and set the old one's status to `Superseded by NNNN`. When practice drifts without the decision changing, append a dated postscript instead. The trail is the point: a later reader needs to see what was believed and why it changed, not only the current answer.
- **Door and Revisit if.** Every ADR carries both fields (the format is in [adr/README.md](adr/README.md), after Michael Nygard). **Door** says whether the decision is one-way, expensive or impossible to undo (a shared URL, a published page, a public repository), or two-way, reversed by a PR. **Revisit if** names the evidence that would show the decision was wrong. When that evidence appears, the decision is reopened, never quietly edited: a superseding ADR if it changes, a dated postscript saying why if it stands.
- **An open question.** Joseph answers with the option letter, in the review or in an issue. Anything the firewall touches goes in the private record ([product.md](product.md#content-firewall)), because reviews, comments and issues go public with the repository. The answer moves to Decided in product.md, which records the option, the date and what ships, with its door and what would show it wrong. A one-way answer also gets an ADR.
- **One PR in flight.** The roadmap's WIP limit counts doc PRs too, so a decision change rides in the PR that needs it.

## Conventions

- Every price, limit and version is labelled "as of 2026-10-22" and carries a source URL.
- Configuration in code fences is a sketch: confirm it against current docs when building.
- Diagrams are mermaid, which GitHub renders.
- Site URLs are written as code, such as `/work/<slug>/`, never as links. Links between docs are relative.
- ISO dates, US English. "Durable Object" is spelled out on first use in each doc, then "DO".
- Each doc ends with "Patterns and further reading". [reading-list.md](reading-list.md) collects the sources.
- Write as if public. The repository may become public ([ADR 0012](adr/0012-public-repository.md)), and selected ADRs render on the site at `/colophon/decisions/<nnnn-slug>/`. The content firewall applies to docs, commit messages and PR text as much as to pages, and its term list never appears here. PR 1's docs are scanned locally before commit; from PR 2, CI scans every pull request.

## Patterns and further reading

- Architecture decision records: Michael Nygard, "Documenting Architecture Decisions" (2011).
- One-way and two-way doors: Jeff Bezos, 2015 letter to Amazon shareholders (Type 1 and Type 2 decisions).
- Goals, non-goals and alternatives considered: Malte Ubl, "Design Docs at Google" (2020).
- One owner per fact, applied to docs: Martin Kleppmann, *Designing Data-Intensive Applications*, Part III, "Systems of Record and Derived Data".
- Everything else: [reading-list.md](reading-list.md).
