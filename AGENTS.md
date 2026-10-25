# Instructions for coding agents

These rules bind every AI agent that works in this repository. The reasons are in
[security.md](docs/security.md#commit-identity-hygiene) and [roadmap.md](docs/roadmap.md#how-we-work).

- **Use the repository's git identity**, the GitHub noreply address. Check it with
  `git config --show-origin user.email`. Never change git configuration to get past a refusal.
- **Confirm the hooks are on before your first commit**: `git config core.hooksPath` must print
  `.githooks` (`pnpm install` warns when it does not). If it prints anything else, stop and ask.
  Never commit without the hooks, and never turn them on or off yourself.
  - **One exception, Joseph's decision of 2026-10-25: a Claude Code cloud session commits and
    pushes without them.** Its machine has no private rules file, so the hooks would refuse every
    commit, and the file is never copied anywhere else. CI's `firewall` job, which holds the rules,
    scans every push instead, but on this public repository a pushed branch is public before that
    scan runs ([security.md](docs/security.md#local-parity)). So a cloud session reads its own
    changes against the pull request checklist's firewall classes before each commit, still never
    sets `core.hooksPath`, and says in each pull request that it committed without the hooks.
- **Commit with `TZ=UTC`** (`TZ=UTC git commit ...`), so commit dates record `+0000` and no time
  zone.
- **Never use `--no-verify`.** A hook that refuses is the content firewall working: fix the cause,
  or stop and ask.
- **Add no `Co-authored-by` trailer** unless its address is in
  `scripts/firewall/allowed-identities.txt`. CI fails any other address.
- **Never force-push a pull request branch while the repository is private.** Fix forward with a
  new commit; merge `main` into the branch instead of rebasing. Never push to `main`.
- **Never commit a firewall term**, in any form: code, tests, fixtures, docs, file names, commit
  messages or pull request text. The rules live only in the private file. Tests use the throwaway
  rules in `scripts/firewall/test.sh`.
