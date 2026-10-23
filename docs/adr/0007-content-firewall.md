# ADR 0007: Content firewall: secret-held rules, fail closed

Status: Proposed · 2026-10-22 · Deciders: Joseph Peterson

## Context

Joseph's rule ([product.md](../product.md)): nothing about his current employer or his private venture appears on the site, in the repository or in commit metadata. That means no names, products, internal system names, colleagues, internal metrics or identifying details. A rule that depends on remembering it fails on the first tired evening, and AI coding agents now write files, commit messages and PR text in this repository too. The rule needs a mechanism.

What the mechanism is up against:

- **Accident, not an adversary.** The likely failure is a name typed into a draft, a work address in commit metadata, or an agent repeating context it was given. Nobody is trying to get past the check.
- **The term list cannot be published.** The list is itself the disclosure. Any design that keeps it in the repository, in any form, has to survive the repository going public ([ADR 0012](0012-public-repository.md)).
- **No server-side help on this account.** GitHub's custom secret-scanning patterns, the managed way to block a pushed string, exist only "for repositories in organizations" ([GitHub](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection)), with GitHub Secret Protection. `IHaveASegway` is a personal account on GitHub Free, where rulesets and required checks also return 403 on a private repository. So the gate is the pipeline: deploy jobs `needs:` the check ([ADR 0006](0006-github-actions-owns-deploys.md)).
- **Runs without secrets.** Dependabot-triggered runs see only Dependabot secrets, and runs from forks see none.
- **Scanners fail open by default.** gitleaks given no configuration "will use the default config" ([README](https://github.com/gitleaks/gitleaks)): generic secret rules that know none of the terms, so the scan passes.
- **When content becomes public.** On a private repository, nothing is public until a preview or a deploy. On a public one, it is public at `git push`.

Prior art:

- GitHub push protection with custom patterns: the managed answer, but organization-only (above).
- [git-secrets](https://github.com/awslabs/git-secrets) (AWS Labs) keeps prohibited patterns in git config, or reads them from a "secret provider" outside the repository. That is the same idea as a secret-held rule set. It runs only as local hooks, and its README gives `--no-verify` as the way past a false positive.
- Google's [Copybara](https://github.com/google/copybara) ("a tool used internally at Google") and Meta's [FBShipIt](https://github.com/facebookarchive/fbshipit) (archived in 2023) move code from a confidential repository to a public one through filters. Both companies gate publication itself, not only detection.

## Decision

1. **Engine:** gitleaks 8.30.1 (released 2026-03-21, the latest as of 2026-10-22 per its [releases](https://github.com/gitleaks/gitleaks/releases)), pinned by version and sha256 in `scripts/firewall/gitleaks.version`. It reads its rules from the `GITLEAKS_CONFIG_TOML` variable, so no rules file enters the repository.
2. **Rules held as a secret.** The source of truth is a private file, `~/.config/ihaveasegway/firewall.toml` (mode 600, backed up in the password manager). `scripts/firewall/sync-secrets.sh` copies it into the Actions secret `FIREWALL_RULES` and into a Dependabot secret of the same name. The terms are never committed and never quoted in any doc. Rule ids are opaque (`fw-01`), and every rule has word boundaries.
3. **Fail closed.** `scripts/firewall/check.sh` (about 80 lines, the only bespoke code) exits 0 when clean, 1 for a finding, and 2 when it cannot prove the result clean: rules missing, empty or below a floor, the canary not detected, a checksum mismatch, `dist/` missing, the base SHA missing, or any gitleaks error. Codes 1 and 2 both fail the job, and `preview` and `deploy` `needs:` it.
4. **Canary.** Each run generates a random `zq-fw-canary-` string and requires the matcher to find it, using a rule that lives inside the secret. Detection proves the secret's rules loaded, which closes gitleaks' fallback to its default rules.
5. **Surfaces:** the tracked tree, the commit range, commit and PR metadata, file paths (a slug is a file name), built output, PDFs, and commit identities checked against a public allowlist (`scripts/firewall/allowed-identities.txt`).
6. **Logs** carry rule id, file, line and commit only. Never a match, and nothing derived from one.
7. **Local parity.** `.githooks/pre-commit` scans the staged diff and the author identity. `.githooks/pre-push` refuses `main` and scans the pushed range. Both read the private file.
8. **Timing.** The check ships with the first workflow, in PR 2. PR 1 (docs only) was scanned locally before commit.

The mechanism, with sketches, is in [security.md](../security.md), under "Content firewall design". Patterns in play: fail-safe defaults and open design (Saltzer and Schroeder, 1975: the mechanism is public and only the rules are secret), a known-answer test (the canary), and policy as code. Sources are in [reading-list.md](../reading-list.md).

## Alternatives considered

| Option | Where the terms live | Prevents publication? | Verdict |
|---|---|---|---|
| **Secret-held rules, CI plus hooks** | A private file and two GitHub secrets | Yes on a private repository; only the hooks on a public one | Chosen |
| Hashed terms in the repository | The repository, as SHA-256 of normalized tokens | As chosen | Rejected. Company and product names are low-entropy. A dictionary of business names in a few spellings is on the order of 10^8 guesses, seconds of hashing, and one right guess confirms a term. Hashes also lose regex, word boundaries and domain variants. |
| Keyed hashes (HMAC) in the repository, the key in a secret | The repository, keyed | As chosen | Rejected. It resists guessing, but its secrecy still rests on a secret. That makes it the chosen design plus a tokenizer, and it still cannot express variants. |
| GitHub custom secret-scanning patterns with push protection | GitHub's settings | Yes, on the server, before a push lands | Not available. It needs an organization repository with GitHub Secret Protection. Moving this repository into an organization adds a second owner to administer and a paid add-on. |
| Local hooks only (the git-secrets model) | The private file | Only when the hooks run | Rejected as the only control. `--no-verify`, edits in GitHub's web interface and agents that skip hooks all bypass it, and nothing checks before a deploy. Kept as the first layer. |
| Private source plus a public mirror (the Copybara pattern) | The private file and the secrets | Yes, even with a public mirror: only commits that passed reach it | The escalation. It costs a second repository, a sync job holding a write credential for the mirror, and pull requests that cannot be merged on the mirror. |

Other engines would also work and add nothing here. TruffleHog's strength is verifying live credentials against their providers, which a term list does not need. Yelp's detect-secrets centers on a baseline file of known findings, a workflow this repository does not have.

The quality attributes traded: the chosen design gives up reviewability of the rules (security of the list over transparency) and accepts a second copy of them (for Dependabot) to keep the gate in one pipeline. The mirror would buy prevention on a public repository at the price of operability.

## Consequences

- Only Joseph can see or review the rules. A rule change shows only through its effect. That fits a one-person repository; a second maintainer would need a review outside it.
- Two copies of the rules can drift. The sync script writes both from one file, and the canary and the floor catch an empty or truncated copy, but not a stale one. A stale Dependabot copy would miss a newly added term in a Dependabot PR; those PRs change manifests and lockfiles, so the exposure is small.
- A pull request from a fork always fails with exit 2, because forks get no secrets. An outside contribution merges only after Joseph pushes it from a branch in the repository.
- Each false positive costs one `.gitleaksignore` fingerprint, reviewed in the diff. Inline `gitleaks:allow` comments are switched off, so a bypass cannot be written into the scanned text.
- gitleaks is in maintenance. Its README calls it "feature complete" and promises "security patches only", and its author has moved to a successor, Betterleaks ([README](https://github.com/gitleaks/gitleaks), as of 2026-10-22). The rules are regex in TOML, so changing engines takes about a day, and the canary proves on the first run whether a new engine loaded them.
- The job costs about 1 billable minute per run ([delivery.md](../delivery.md)).
- Regex does not see paraphrase, images, image metadata, or combinations of harmless facts that identify an employer (the mosaic effect). The PR checklist carries paraphrase and what images show; a metadata check in the pre-commit hook and `verify`, then the image pipeline, carry image metadata ([security.md](../security.md)). The checklist depends on attention.
- If the repository goes public, the hooks become the only control before publication, and CI only detects ([ADR 0012](0012-public-repository.md)).
- ADRs render on the site at `/colophon/decisions/<nnnn-slug>/` when Joseph opts them in ([ADR 0001](0001-record-architecture-decisions.md)), and this one may be among them. It names the mechanism and no term, by construction.

## Door

Two-way for the mechanism. The engine, the scripts and where the rules live can each change in a day, and nothing else depends on them. One-way for what it guards: a published leak cannot be recalled from clones, forks and caches. That asymmetry is why the check fails closed. A false alarm costs a re-run; a miss is permanent.

## Revisit if

- Any term reaches a deployed page or a public commit, even one that CI caught afterwards: move to a private source repository with a public mirror that CI publishes.
- More than one false positive a month, two months running: tighten the rules (case, phrases, domain forms).
- gitleaks misses a security fix, or a release breaks the canary: change engines, with Betterleaks the first candidate to evaluate. The rules carry over.
- A second person or a second agent account needs to change rules: decide how rules are reviewed outside the repository.
- The repository moves into a GitHub organization: add custom secret-scanning patterns with push protection as a server-side layer in front of this one.
