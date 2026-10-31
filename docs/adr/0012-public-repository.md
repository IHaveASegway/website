# ADR 0012: Public repository after the firewall audit

Status: Accepted · 2026-10-25 (proposed 2026-10-22) · Deciders: Joseph Peterson

## Context

**Decided by Joseph on 2026-10-25** (Q7 · Q-visibility in [product.md](../product.md)): he made the repository public. The record below is the recommendation as written; the postscript says what held at the switch.

`IHaveASegway/website` is private, on a GitHub Free personal account. As of 2026-10-22, that means:

- Rulesets and branch protection return 403: "Upgrade to GitHub Pro or make this repository public to enable this feature." Free offers deployment protection rules for public repositories only ([plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)). So "PR-only `main`" and required checks cannot be enforced on the server. The gate is the pipeline's `needs:` plus a local pre-push hook ([ADR 0006](0006-github-actions-owns-deploys.md)).
- Actions: 2,000 minutes a month for private repositories on Free and 3,000 on Pro; standard runners are free for public repositories ([plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). The pipeline is modelled at about 865 minutes a month, about 1,312 in a busy month, from job times measured on 2026-10-23 ([delivery.md](../delivery.md)).
- GitHub Pro costs $4 a month ([GitHub's plans FAQ](https://docs.github.com/en/get-started/learning-about-github/faq-about-changes-to-githubs-plans)). GitHub's pricing page no longer lists Pro, so confirm the price in billing settings before buying.

The site exists to show how Joseph decides ([product.md](../product.md)). This repository holds the ADRs, the pipeline and the firewall's design. That is evidence a hiring manager can read, and a private repository hides it. Cloudflare keeps the source of its own docs site in a public repository that deploys from GitHub Actions with a preview per pull request (cloudflare/cloudflare-docs), the pattern [ADR 0006](0006-github-actions-owns-deploys.md) follows.

Going public moves the trust boundary ([ADR 0007](0007-content-firewall.md)). Content becomes public at `git push`, before CI runs, so CI can only detect. After a history rewrite, old commits stay reachable through forks, clones, cached views and pull requests, and the last two need GitHub Support to clear ([GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)). The switch also publishes the past: "Actions history and logs will be visible to everyone." Switching back recalls nothing: "Current forks will remain public and will be detached from this repository" ([GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)).

## Decision

Make the repository public once all three hold:

1. The firewall job runs in CI and is green on `main` (PR 2).
2. A full-history audit is clean: `gitleaks git --log-opts=--all` with the current rules, the identity check over every commit, and a read of every past PR title, body, review, review comment and conversation comment, every issue and issue comment, each with its edit history, every branch name and every Actions log (each can be listed with `gh api`), because the switch publishes all of them. A finding in an edit history is removed by deleting that revision, because editing the text leaves the old revision visible ([GitHub](https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment)). Actions logs are also checked for the account ID and email addresses ([security.md](../security.md#scrubbing-evidence)), or the runs from before the switch are deleted. The audit runs on a clone that has also fetched every pull request head (`git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'`). A normal clone fetches branches only, but GitHub keeps each pull request's head in the read-only `refs/pull/` namespace after its branch is deleted ([GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally)), and the switch publishes those too. Commits replaced by a force push stay reachable by SHA, where no clone sees them, so until the switch, pull request branches take new commits instead of force pushes ([roadmap.md](../roadmap.md#how-we-work)).
3. Joseph says yes, in writing (Q7 · Q-visibility).

On the same day, after the switch:

- A ruleset on `main`: a pull request is required, with 0 approvals (GitHub does not let authors approve their own pull requests, and there is one maintainer); required checks `verify`, `firewall` and `e2e`, and `lighthouse` since 2026-10-25 ([ADR 0006](0006-github-actions-owns-deploys.md), postscript of that day); no force pushes; no deletion.
- Secret scanning and push protection stay on. GitHub provides them on public repositories, and they recognize all three Cloudflare credential formats ([supported patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns)).
- "Require approval for all external contributors" for workflows from fork pull requests ([GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)). The allowed-actions list does not change.
- Private vulnerability reporting on, which gives `security.txt` a URL under either mail posture ([security.md](../security.md)).

The pattern is a one-way door taken behind preconditions: an audit that has to pass before the step that cannot be undone.

## Alternatives considered

| Option | Cost, as of 2026-10-22 | `main` enforced by | Prevention before publication | Evidence value | Door |
|---|---|---|---|---|---|
| **A. Public after the audit (recommended)** | $0; Actions free | A ruleset with required checks | Local hooks only; CI detects afterwards | High: the source, the ADRs and the pipeline are readable | One-way |
| B. Private, plus GitHub Pro | $4 a month; 3,000 Actions minutes | Protected branches with required checks | CI prevents: nothing is public before a deploy | Low: only the site | Two-way |
| C. Private on GitHub Free (today) | $0; 2,000 Actions minutes | The pipeline's `needs:` and a pre-push hook | CI prevents | Low | Two-way |
| D. Private source, public mirror published by CI (the [Copybara](https://github.com/google/copybara) pattern) | $0, or $4 a month to protect the source as well; a second repository; a sync job holding a write credential for the mirror | A ruleset on the mirror; the source by convention, or Pro | CI prevents: the mirror receives only commits that passed | High | Two-way for the source; one-way for whatever reaches the mirror |

In quality attributes: A trades security (prevention before publication) for evolvability and evidence, at no cost. B keeps prevention and pays $48 a year and the evidence. D keeps both, and pays in operability: two repositories, a sync job and a credential to run.

Also rejected: public right now. The firewall is not in CI yet, and no full-history audit has run.

## Consequences

Benefits:

- Evidence: a hiring manager can read the decisions behind the site, not only the site.
- Server-side enforcement at no cost. The ruleset replaces the pipeline-only gate of [ADR 0006](0006-github-actions-owns-deploys.md), and its required checks hold for Joseph too.
- Actions minutes stop counting, so the 2,000-minute ceiling stops mattering.
- Push protection blocks known token formats, Cloudflare's included, before they land.

Costs:

- Prevention moves to the laptop. The local hooks are the only control before publication, and agents, web edits and `--no-verify` bypass them. CI detects after the fact ([ADR 0007](0007-content-firewall.md)).
- A leak is permanent in practice. Forks, clones and caches keep it; a rewrite and GitHub Support shrink the exposure, they do not erase it.
- Pull requests from forks fail the firewall, because forks get no secrets. Outside contributions reach `main` only after Joseph pushes them from a branch in the repository.
- Actions logs, issues and pull requests are public. Logs follow the firewall's logging rules; spam in issues becomes possible.
- Commit identities, PR text and branch names join the public surface the firewall protects ([security.md](../security.md), "Commit identity hygiene").
- Any later change of visibility erases stars and watchers.

## Door

One-way. Once the repository is public, every commit, PR text and log can be copied. Switching back leaves existing forks public and detached, and clones untouched. The audit comes first because there is no undo.

## Revisit if

- Before the switch, the full-history audit finds anything: stop. Fixing forward leaves the term in history, and a rewrite leaves it reachable through pull requests and cached commit views until GitHub Support dereferences them ([GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)). Either rewrite, ask Support to purge, and audit again, or publish a new public repository from a clean snapshot and keep this one private as the archive. The second gives up the pull request history but needs no one else's help.
- After the switch, any term reaches a public commit, even one that CI caught: move to option D and run the leak-response runbook ([operations.md](../operations.md)).
- Hook bypasses become routine (agents, web edits): option D.
- Spam or abuse in issues and pull requests costs more than an hour a month: use GitHub's interaction limits, or turn issues off.
- The evidence goes unread: GitHub's traffic view of the repository (the last 14 days) shows no visits referred from the site in three monthly checks. Then the main benefit is not arriving, and option B or D deserves a second look.

## Postscript, 2026-10-25

Joseph made the repository public on 2026-10-25, between 12:57 UTC (a Dependabot run still recorded it as private) and about 13:45 UTC (an anonymous request returned it). Of the three preconditions, the third held. The first did not: `firewall` was red on `main` from the Route Lab merge on, for a WebAssembly file it cannot read and for chance runs of numbers in the route data, so nothing new deployed. The second, the full-history audit, ran only in part. What the switch still needs (the ruleset, push protection, private vulnerability reporting, and the checks the audit could not make) is in [roadmap.md](../roadmap.md#gate-repository-public) and [operations.md](../operations.md).

## Postscript, 2026-10-31

The firewall self-test moved out of `verify` into a job of its own, `firewall-selftest`, which `deploy` needs ([ADR 0006](0006-github-actions-owns-deploys.md), postscript of that day). The ruleset's required checks gain it: `verify`, `firewall`, `firewall-selftest`, `e2e` and `lighthouse`.
