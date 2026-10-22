# ADR 0004: Content lives in the repo; LinkedIn owns employment history

Status: Proposed · 2026-10-22 · Deciders: Joseph Peterson

## Context

The site publishes words and a few facts: case studies, essays, field notes, lab write-ups, a `/now/` page, a public profile (title, arc, skills, education, links), the ADRs, and facts about Joseph's projects (latest release, tag dates). Each needs one system of record: the place where a fact is written, which every other place reads or links to. Two owners of one fact drift apart, and nobody can say which is right.

Three constraints shape the choice:

- **The content firewall** ([ADR 0007](0007-content-firewall.md)). Nothing about the current employer may reach the site, the repo or commit metadata. The firewall can check only what passes through the pipeline: the tracked tree, the commit range, pull-request text and the built output. Content kept anywhere else reaches the site without that check.
- **One author with a few hours a month.** [content.md](../content.md) budgets about 8–10 hours of writing a month. Whatever stores content must not need operating.
- **A static site** ([ADR 0003](0003-astro-static-first.md)). Content enters at build. No code runs on a page view, so nothing can be fetched when a visitor arrives.

Employment history is the hard case. Recruiters want it, LinkedIn already holds it, and it is full of the employer's name.

## Decision

One owner per piece of data:

| Data | System of record | Written by | How it reaches the site | Consistency readers need |
|---|---|---|---|---|
| Case studies, essays, notes, lab write-ups, `/now/` | Markdown and MDX in `apps/web/src/content/**` | Joseph, by pull request | At build, validated by Zod (schema-on-write) | As of the last deploy, minutes after merge |
| Public profile: title, arc (role titles and years, no employer), skills, education, links | `apps/web/src/content/profile.json`, a JSON Resume subset with no employer field | Joseph, by pull request | At build; renders `/about/`, Home, the JSON-LD, and later `/resume/` | As of the last deploy; compared with LinkedIn each quarter |
| Employment history, with employer names | LinkedIn, plus Joseph's private résumé | Joseph, on LinkedIn | Never copied. At most a link, if Q-threat-model allows it | Not applicable |
| Project facts: latest release, tag dates | GitHub | Each project's release process | Read from GitHub's API once per build, never at request time; a weekly scheduled rebuild refreshes them | Eventual: at most a week old |
| Decisions | `docs/adr/*.md` | Joseph, by pull request | At build, from the same files; rendered at `/colophon/decisions/<nnnn-slug>/` | As of the last deploy |

- **No CMS.** The repo is the content store, git is its history, a pull request is its review, and the firewall job is its gate.
- **The profile schema has no slot for the employer.** Its objects are strict, so an employer field, a city, an address, an email or a phone number in `profile.json` fails the build. Free-text values (the title, the arc) can still carry a name; the firewall scan covers those. The schema is in [content.md](../content.md).
- **Nothing is fetched at request time.** If GitHub does not answer during a build, the project line is dropped, not guessed, and the build goes on.

Prior art. This is docs as code applied to a personal site. Cloudflare's developer documentation is MDX in the public `cloudflare/cloudflare-docs` repository, built with Astro (astro 7.4.1 in its `package.json`, as of 2026-10-22), with its content under `src/content/` ([repository](https://github.com/cloudflare/cloudflare-docs)). It is the same pattern this site uses, at a far larger size. GitLab keeps its company handbook in a repository and changes it through merge requests ([Editing the handbook](https://handbook.gitlab.com/handbook/about/editing-handbook/)). The profile uses JSON Resume, an open schema under the MIT license ([jsonresume.org](https://jsonresume.org/schema)), so any résumé tool can read the same file.

## Alternatives considered

- **Headless CMS (Contentful, Sanity).** Content lives in the vendor's hosted store (Contentful's Content Delivery API, Sanity's [Content Lake](https://www.sanity.io/docs/content-lake)); the build pulls it, and a webhook triggers deploys. Gains: an editor in any browser, phone included; structured content. Costs: a second system of record outside git, so content changes skip pull-request review and the commit-range scan, leaving only the scan of built output; a vendor account and one more API token in CI (security); an export-and-transform job to leave (evolvability); a build that fails whenever the vendor's API does (availability). Rejected: it moves content out of the firewall's reach to solve a problem, writing away from a laptop, that does not exist yet.
- **Git-based CMS (Keystatic, TinaCMS).** An editing UI that writes Markdown, JSON or YAML back to the repo, so the repo stays the system of record. Keystatic is "Content Management for your Codebase", with "No database" ([keystatic.com](https://keystatic.com/)). TinaCMS keeps content "backed by git into JSON/Markdown/MDX files" ([tina.io](https://tina.io/docs)). Costs: a deployed editor runs server code (security, operability). Keystatic's Astro guide says "you will need to add an Astro adapter to deploy your project" ([Keystatic](https://keystatic.com/docs/installation-astro)), which puts code on the site Worker that [ADR 0003](0003-astro-static-first.md) keeps static. TinaCMS needs its hosted backend, TinaCloud, or one you host: a service with write access to the repo either way. Either editor must be set to open pull requests, not commit to `main`, or it walks around the gate. Deferred, not rejected: it is the first step if writing friction appears. Keystatic's local mode (an editor in the dev server, nothing deployed) is the cheapest trial, and the trial has to show that the production build still needs no adapter.
- **Notion as CMS.** The best writing experience of the four, on any device. Costs: content outside git again, so no review and no commit scan (security); the API allows 180 requests per minute per connection on plans below Business, an average of 3 per second ([Notion request limits](https://developers.notion.com/reference/request-limits), as of 2026-10-22); Notion-hosted file URLs expire after one hour ([Notion file object](https://developers.notion.com/reference/file-object), as of 2026-10-22), so every image has to be downloaded and re-hosted at build (operability); Notion's blocks need a converter to become Markdown, and any block with no Markdown equivalent needs hand mapping (evolvability); drafts live in a third party's workspace (security). Rejected.
- **Copy the résumé into the repo:** a full JSON Resume with employer names, rendering everything from one file. Gains: one file drives `/about/`, `/resume/` and the JSON-LD. Costs: the employer's name in the repo, which the firewall forbids and which a public repo publishes at `git push` ([ADR 0012](0012-public-repository.md)); a second owner of the facts LinkedIn already holds, so the two drift; and a firewall that would have to allowlist the very terms it exists to block. Rejected. This is the weaker design the decision exists to prevent.

Patterns: single source of truth (Hunt and Thomas, *The Pragmatic Programmer*, the DRY principle), schema-on-write (Kleppmann, *Designing Data-Intensive Applications*, chapter 2), docs as code ("writing documentation with the same tools as code": [Write the Docs](https://www.writethedocs.org/guide/docs-as-code/)). Sources: [reading-list.md](../reading-list.md).

## Consequences

- Every word takes one review path: a pull request, the firewall job, a preview, then production ([ADR 0006](0006-github-actions-owns-deploys.md)). While the repository is private, the firewall sees content before any visitor does. Once it is public, a push publishes the Markdown before CI runs, and the local hooks are the only prevention ([ADR 0012](0012-public-repository.md)).
- Content is plain files: portable to another static-site generator, diffable, and recoverable from any clone. The benchmark run for this plan built 300 MDX posts in 1.72 s (3.5 s wall clock) on Astro 7 (2026-10-22), so content volume is not a build-time concern at this size.
- Writing needs a laptop, an editor and git. A typo fix is a pull request and a merge: about 19 billable Actions minutes while the repository is private (10 for the pull request, 8 for the merge, 1 for preview cleanup) and none once it is public ([delivery.md](../delivery.md)).
- One relationship needs upkeep. No fact has two owners: `profile.json` owns the public wording (the title, and role names and years with no employer), and LinkedIn owns the employment record. Q-title adds a consistency rule across the two owners: the public title should match LinkedIn's. A quarterly hand check enforces that rule ([operations.md](../operations.md)). Copying the whole history instead would replace one rule with a second copy of every role, the employer's name included.
- Project facts can be up to a week old between scheduled rebuilds.
- Images and screenshots are content too. They arrive through the same pull request, stripped of metadata before the commit, because a public repository publishes at push; the build strips again ([security.md](../security.md)).

## Door

Two-way. Content is Markdown, MDX and JSON in git. Adding a git-based CMS leaves every file where it is; moving to a headless CMS is an import script. What is one-way is publication itself, because archives and preview caches keep what was shown, and [ADR 0007](0007-content-firewall.md) governs that, not this record.

## Revisit if

- Writing stalls for want of a laptop: two or more post ideas in a quarter go unwritten because Joseph was away from one, or he wants to write from a phone. Then try a git-based CMS that opens pull requests, local mode first.
- A second author joins. Review and permissions then matter more than the simplicity of plain files.
- Project facts need to be fresher than a week. Then each project's release workflow triggers a rebuild (`repository_dispatch`) instead of the site polling.
- Q-threat-model's answer rules out any traceable link (option c). The LinkedIn link goes; ownership does not change, and the site shows no employment history at all.
