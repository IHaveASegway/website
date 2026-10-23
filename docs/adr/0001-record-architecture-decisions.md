# ADR 0001: Record architecture decisions

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

One person maintains this site. He is training to become a software architect, and part of the site's job is to show how he decides. Three readers need the decisions written down:

- **His future self.** A year from now he will remember what was chosen and not why. Without the why, a decision is either reopened every time it is inconvenient or kept long after its reason has gone.
- **Reviewers.** A hiring manager or engineer reading the repository, and later the site's colophon, sees the code but not the options that lost. For senior and architect roles, the options that lost are the evidence.
- **The pull request reviewer,** who is also Joseph. A decision written on its own page can be accepted or rejected on its merits. A decision buried in a diff gets accepted with the diff.

His strongest professional work cannot be shown ([ADR 0007](0007-content-firewall.md)), so decisions about work he owns carry that load. The repository may become public ([ADR 0012](0012-public-repository.md)), which makes these records part of the portfolio, and also means every word in them must be safe to publish.

He already keeps ADRs in stillhere: 15 of them, in Nygard's format plus Door and Revisit if. Using the same format here means a reader of one repository can read the other.

Not every choice deserves a record. PR 1 proposes eleven more ADRs, and several of them are two-way doors. They are recorded because a reviewer would ask "why not X?", or because they move a boundary, not because they are irreversible. The rule below says when that is worth an hour of writing.

## Decision

- **Format.** The one stillhere uses: Nygard's Context, Decision, Status and Consequences, plus an **Alternatives considered** section (with the quality attributes each one trades) and the two fields the index names, **Door** (one-way or two-way, and why) and **Revisit if** (the evidence that would show the decision was wrong). The template is in the [index](README.md).
- **When to write one.** An ADR is written when a decision meets any of these:
  1. Reversing it costs more than about a day, or breaks something outside the repository: a shared URL, a public history, stored data, a published protocol version.
  2. It picks one technology, provider or plan over alternatives a reviewer would ask about.
  3. It moves a boundary: who owns a piece of data, what runs where, or who can deploy.

  Everything else is decided in the pull request and written into the doc that owns the topic. The repository layout is an example: it lives in [delivery.md](../delivery.md) and has no ADR.
- **Files.** One decision per file, `docs/adr/NNNN-short-title.md`, numbered in order. A number is never reused. A file is never renamed after it merges, because from PR 3 its name becomes part of a URL (below).
- **Lifecycle.**
  - An ADR starts as **Proposed**, usually in the pull request that needs it. Merging a pull request does not accept the ADRs in it.
  - Joseph accepts an ADR in a pull request review by changing its status line to **Accepted** with the date. At the latest, that happens in the pull request that first builds on the decision. Until then a Proposed ADR can be edited or rewritten freely, including to record a different choice from the one first proposed.
  - An Accepted ADR is not rewritten. A changed decision gets a new ADR that supersedes it, and the old one's status becomes **Superseded by NNNN**. Besides that status change, the only edits an Accepted ADR gets are typo fixes and postscripts.
  - When practice differs from an Accepted decision without changing it (a limit turned out different, a step was done another way), a dated `## Postscript YYYY-MM-DD` is appended after Revisit if. It says what differs, why, and whether any Revisit if condition was met.
  - The index in [README.md](README.md) changes in the same pull request as the ADR.
- **Public-safe by construction.** ADRs say "the current employer", "the term list" and "a private venture", never the thing itself. When a decision depends on a sensitive input, that input stays in a private file, as the firewall's term list does ([ADR 0007](0007-content-firewall.md)), and the ADR refers to it generically. ADRs are scanned by the content firewall like every other file; PR 1, which has no CI yet, was scanned locally.
- **Rendered later.** From PR 3, selected ADRs render on the site at `/colophon/decisions/<nnnn-slug>/` ([ADR 0005](0005-url-scheme.md)). Rendering is opt-in per ADR: the site's ADR loader renders only the numbers on its allowlist ([content.md](../content.md)), so a new ADR cannot reach the site by accident. That is a fail-safe default. `docs/adr/` stays the system of record: the site reads it at build time and never holds a copy that could drift.

## Alternatives considered

- **MADR 4.0** (Markdown Architectural Decision Records; 4.0.0 released 2024-09-17, the current version as of 2026-10-22, [adr.github.io/madr](https://adr.github.io/madr/)). Its sections are Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome (with Consequences and Confirmation), Pros and Cons of the Options and More Information, under YAML front matter for status, date, decision-makers, consulted and informed. It gains tooling and team-scale evolvability: the front matter is machine-readable, and consulted and informed matter when several people decide. It costs weight for one decider, whose consulted and informed fields would stay empty. Its Confirmation section (how compliance will be checked) is close to Revisit if (what evidence would show the decision wrong) but is not the same question. It would also make this repository's ADRs read differently from stillhere's. Rejected for now; see Revisit if.
- **Design docs only**, in the style Malte Ubl describes in ["Design Docs at Google"](https://www.industrialempathy.com/posts/design-docs-at-google/) (2020): context and scope, goals and non-goals, the design, alternatives considered. `docs/` already is that set, and it stays. But a design doc is edited as the design changes. That is right for describing the system as it is and wrong for a decision log: the reasoning at the time of the decision is overwritten, and nothing records whether a choice was accepted. It trades traceability for one fewer set of files. Both are kept: `docs/` describes the current design, and ADRs keep each decision as it was made.
- **No records**: decide in pull request descriptions and commit messages. Zero overhead today. Pull request text lives on GitHub rather than in the repository, so it does not travel with a clone or a mirror, cannot render on the site, and cannot be reviewed as a set. It trades all later legibility for speed now, and it fails the portfolio need outright.
- **Amend in place**, as stillhere does for its ADRs 0005 and 0007. One file per topic is easier to find. But what a reader takes away depends on how far down the page they read, and the index has to carry two statuses ("Accepted; amendment Proposed"). On a site where a single ADR renders as its own page, a superseding ADR with links both ways is clearer.

Prior art, and why nothing is built: [adr-tools](https://github.com/npryce/adr-tools) (Nat Pryce) creates and supersedes Nygard-format files from the command line, and [Log4brains](https://github.com/thomvaill/log4brains) renders ADRs as a static site. Neither is needed: twelve files need no generator, and the site already renders Markdown through Astro's content collections ([ADR 0003](0003-astro-static-first.md)). The combination is Markdown files, the existing build and the existing firewall scan, with no new tool. Spotify's engineering blog answers "when" with "An ADR should be written whenever a decision of significant impact is made" ([Josef Blake, 2020](https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record)). The Guardian keeps its ADRs public in its rendering repository ([dotcom-rendering ADR 026](https://github.com/guardian/dotcom-rendering/blob/main/dotcom-rendering/docs/architecture/026-better-partial-hydration.md)), and AWS documents an [ADR process](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html) in its Prescriptive Guidance.

## Consequences

- A pull request that makes a qualifying decision carries its ADR. Writing one takes about an hour (an estimate; stillhere's run from 32 to 97 lines).
- The ADR and the index change together, and the definition of done in [roadmap.md](../roadmap.md) checks both.
- Superseded ADRs stay in the folder with a link forward. The history is visible, and the index shows which decision is current.
- Wrong calls stay visible once the repository or the colophon is public. That is intended: a record that shows a decision changing, and why, is better evidence than one that is always right. stillhere publishes the failed validation of its own headline metric for the same reason.
- File names freeze at merge, because rendered ADRs get URLs.
- Some context is written generically to pass the firewall. A reader occasionally gets "the current employer" where a name would be clearer. That is the cost of a public record.
- Ceremony is the main risk: twelve ADRs before any code could turn into a habit of writing instead of building. The three-part threshold, and the rule that other decisions are made in the pull request, are the guard.

## Door

Two-way. The records are Markdown files in one folder, so changing the template later costs a superseding ADR and an edit to the index. The part that hardens is a rendered ADR's URL once someone shares it; [ADR 0005](0005-url-scheme.md) covers that.

## Revisit if

- A decision that met the threshold merged without an ADR more than once in a quarter. Either the threshold or the habit is wrong.
- Proposed ADRs older than 90 days outnumber Accepted ones. The acceptance step is not happening and needs a date in the roadmap, or the decisions already in effect should be accepted as built.
- More than a quarter of Revisit if sections name no evidence anyone could observe. The format is being filled in rather than used.
- A second regular contributor joins. MADR's decision-makers, consulted and informed fields start to earn their place, and acceptance should not rest on one person.
- After a year of rendered decisions, no reader or reviewer has mentioned one. Keep writing them for maintenance, and stop treating them as portfolio pieces.
