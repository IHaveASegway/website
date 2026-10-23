# Operations

How the site is set up, watched and repaired by one person: access setup, observability, alerting, runbooks, and the maintenance calendar. Each runbook is a short numbered list meant to be followed under stress, with the reasoning kept to a line. The pipeline these runbooks drive is in [delivery.md](delivery.md); zone settings, mail posture, the secrets inventory and account continuity are in [security.md](security.md).

Status: Draft for review in PR 1 · 2026-10-22

## Access setup

Order for PR 2: step 6, then 1, then 5, and step 3, since Q2 · Q-mail chose Email Routing on 2026-10-22 ([product.md](product.md#decided)). Step 4 comes with PR 3b, step 7 with PR 6, and step 2 is as needed.

Three rules apply to every credential below:

- **Never use a Global API Key anywhere, and never keep one in a shell environment.** One key carries every permission of the user in every account, registrar and billing included ([token formats](https://developers.cloudflare.com/fundamentals/api/get-started/token-formats/)), and every process started from that shell can read it.
- **No Cloudflare credential lives in a shell startup file.** Only the process that needs a token gets it, in that process's environment; for Wrangler that variable is `CLOUDFLARE_API_TOKEN` ([system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)).
- **Never run `wrangler login`.** Without flags it asks for every available OAuth scope and keeps the access and refresh tokens in a plaintext file in Wrangler's config directory ([Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/general/), as of 2026-10-22). Local development needs no account: `astro dev` serves the site, and `wrangler dev` runs the Worker locally with simulated bindings. Anything on the laptop that has to call Cloudflare, a spike included, gets a short-lived token from [step 2](#2-short-lived-tokens-for-inspection-and-one-off-changes-as-needed).

### 1. Deploy token (PR 2)

One account-owned API token, prefix `cfat_`, used by the `preview`, `deploy`, `rollback` and `preview-cleanup` steps ([ADR 0006](adr/0006-github-actions-owns-deploys.md)). An account-owned token acts as a service principal of the account, not on behalf of a user ([Cloudflare](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)).

1. Cloudflare dashboard → select the account → Manage account → Account API tokens → Create Token → a custom token named `github-actions-deploy`.
2. Permissions, exactly these four:

   | Scope | Permission | Why |
   |---|---|---|
   | Account | Workers Scripts: Edit | Upload versions, deploy, create and delete previews, roll back |
   | Account | Account Settings: Read | Wrangler reads account details |
   | Zone `ihaveasegway.com` | Workers Routes: Edit | Route changes through `wrangler triggers deploy`, and the lab's `/lab/api/*` route in Phase 4 |
   | Zone `ihaveasegway.com` | Zone: Read | Wrangler resolves the zone for routes and the custom domain |

   Left out on purpose: DNS, zone settings and certificates (zone configuration stays in the dashboard), KV, R2 and D1 (nothing binds them), and Workers Tail. That this set can attach the custom domain is likely but untested; spike S7 settles it ([roadmap.md](roadmap.md)). If it fails, add only the permission the API error names, and record it here, in the [secrets inventory](security.md#secrets-inventory) and in ADR 0006.
3. Zone resources: Include → Specific zone → `ihaveasegway.com`.
4. **Client IP Address Filtering: leave it empty.** GitHub-hosted runners draw from shared cloud address ranges, published in the `actions` key of `GET /meta` and "updated once a week". GitHub itself says "we do not recommend that you use these as allowlists" ([GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). The ranges are shared with every other customer's jobs, so an allowlist would not tell this repository's workflow from anyone else's, and a weekly change could break deploys without warning. As of 2026-10-22, static egress addresses need larger runners on GitHub Team or Enterprise Cloud; this is a personal Free account.
5. TTL: an end date 12 months out. Cloudflare reads the date as 00:00 UTC on that day ([token restrictions](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/)). Write the date into the [maintenance calendar](#maintenance-calendar), with a reminder 30 days ahead.
6. Create the token and copy the value; it is shown once.
7. Store both values without either touching shell history or a file. `gh secret set` reads the value from a prompt when no `--body` is given ([gh](https://cli.github.com/manual/gh_secret_set)):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN --repo IHaveASegway/website
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo IHaveASegway/website
   ```

   The account ID is an identifier, not a credential, but it is stored as a secret anyway. GitHub masks secrets in logs, while "variables render unmasked in your build outputs" ([GitHub](https://docs.github.com/en/actions/concepts/workflows-and-actions/variables)), and the logs go public with the repository at the [ADR 0012](adr/0012-public-repository.md) switch. Wrangler reads it from the environment, so `wrangler.jsonc` carries no `account_id`.
8. Before the first deploy from `main`, which comes before any preview, check the names the pipeline will expose: every preview and Version URL carries the account's workers.dev subdomain, and the Worker and account names show in the dashboard and in logs. None may name anything the firewall blocks, or any part of an email address ([security.md](security.md)). The subdomain in particular is public from the first preview comment on, and old comments keep it, so any rename comes before that comment. Also confirm that no other Worker in the account answers on that subdomain: every other Worker has workers.dev and Version URLs off, confirmed with a request to its workers.dev hostname, or it moves to its own account. Re-check after any change to that Worker.
9. Verify with PR 2's first deploy from `main`, then the first pull request's preview after it, not by exporting the token in a local shell. The deploy comes first: until production exists, `preview` publishes nothing ([delivery.md](delivery.md#pipeline)). Those runs are spike S7 too, since it moved inside PR 2 on 2026-10-22, so S7 needs no token of its own ([roadmap.md](roadmap.md#spikes)).

### 2. Short-lived tokens for inspection and one-off changes (as needed)

For an agent or a script that has to read account state (zone settings, usage, a `cf-terraforming` export), for a single planned change through the API, or for a spike. Never stored in GitHub, the repo, or a shell startup file.

1. Manage account → Account API tokens → Create Token → a custom token named for the task and the date, such as `inspect-2026-10-22`.
2. Permissions for inspection. Account: Account Settings Read, Workers Scripts Read, Billing Read, Account Analytics Read. Zone `ihaveasegway.com`: Zone Read, Zone Settings Read, DNS Read.
3. TTL: 7 days.
4. Hand it to the one process that needs it, in that process's environment only. Delete the token when the task ends rather than waiting for the expiry.
5. For a one-off write, the same steps with only the permissions the task needs, a 1-day TTL, and deletion right after. Never the deploy token. An API step of the HSTS ramp ([ADR 0011](adr/0011-dnssec-and-hsts-ramp.md)) needs Zone Settings Edit on this zone. The spikes ([roadmap.md](roadmap.md#spikes)): S1 and S3–S6 need Workers Scripts Edit and Account Settings Read; S2 needs those, plus Workers Routes Edit and Zone Read on this zone, and edit access to its WAF custom rules (confirm the permission names when creating the token); S7 has its own token ([step 1](#1-deploy-token-pr-2), item 9); S8 and S9 need none.
6. Account tokens cannot read Registrar data. The domain's expiry and lock come from RDAP, which needs no token: `curl -s https://rdap.verisign.com/com/v1/domain/ihaveasegway.com | jq '.events, .status'`.

### 3. Email Routing (after Q2 · Q-mail)

Q2 · Q-mail chose the receive-only `hello@` posture, and Email Routing was set up on 2026-10-22. The records, and the alternative posture, are in [security.md](security.md).

1. Dashboard → Compute → Email Service → Email Routing → Onboard Domain → `ihaveasegway.com`. Review the records Cloudflare will add (MX, an SPF TXT record and a DKIM TXT record), then Done ([Email Routing](https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/)).
2. Destination Addresses → add Joseph's personal inbox → open Cloudflare's message and select "Verify email address". The destination address is never written into the repo, a doc, a commit or an issue.
3. Routing Rules → Create routing rule → Email pattern `hello` → Action "Send to an email" → the verified destination → Save. Leave catch-all off.
4. Add DMARC by hand, since onboarding adds MX, SPF and DKIM only: a TXT record at `_dmarc` with the value in [security.md](security.md).
5. Send a test from an outside account. Replies go out from the personal address; nothing sends as `hello@`.
6. Run `scripts/verify-zone.sh`, and record the change with its date under the zone checklist in [security.md](security.md#zone-hardening-checklist). The "As found" column keeps what was found before.

### 4. Web Analytics, manual beacon (PR 3b)

Q18 · Q-analytics chose it on 2026-10-22 ([product.md](product.md#decided)). It ships with the colophon in PR 3b, which carries its disclosure; steps 1 to 3 are Joseph's, in the dashboard, before that pull request starts.

1. Dashboard → Web Analytics → Add a site → select `ihaveasegway.com` → Done. For a proxied site this turns on automatic setup ([Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/)).
2. Manage site → "Enable with JS Snippet installation". Automatic injection stays off: an injected script would change the served bytes after CI tested them, and the CSP would have to allow it.
3. Copy the token from the snippet. It is public by design, since every page carries it, so it lives in the site's config in the repo. Putting a public value in the secret store adds nothing but confusion about what is secret.
4. Add the snippet to the base layout, and the two CSP entries listed in [security.md](security.md).
5. Block the beacon's host in Playwright and Lighthouse, so CI runs are not counted as visits. The same build serves previews and production (build once), so the build itself cannot leave the beacon out of previews.
6. After the deploy, load the site and confirm the visit appears in the dashboard.

### 5. Local hooks and the private firewall file (PR 2)

The rules are never committed and never quoted ([ADR 0007](adr/0007-content-firewall.md)). The private file is the source of truth; the two GitHub secrets are copies of it.

1. In the clone: `git config core.hooksPath .githooks`. The setting is per clone. `pnpm install` warns until it is set (`scripts/check-hooks.sh`, run as the root `postinstall` script), but no script sets it: an install should not change git configuration as a side effect.
2. Commit identity: `git config --show-origin user.email` must show the GitHub noreply address ([security.md](security.md)).
3. Create the rules file, readable only by its owner:

   ```sh
   install -d -m 700 ~/.config/ihaveasegway
   ( umask 077 && "${EDITOR:-vi}" ~/.config/ihaveasegway/firewall.toml )
   chmod 600 ~/.config/ihaveasegway/firewall.toml
   ```

   The content is gitleaks TOML with opaque ids, word boundaries on every word, and the `fw-canary` rule last; [security.md](security.md#rule-writing-rules) has the rule shape with placeholders. Set `RULE_FLOOR` in `scripts/firewall/check.sh` to the file's rule count, the canary included. The number is not a secret.
4. Back the file up in the password manager.
5. Run `scripts/firewall/test.sh`, the self-test with a throwaway rule.
6. Run `scripts/firewall/sync-secrets.sh`. It copies the file into the Actions secret and the Dependabot secret, both named `FIREWALL_RULES`. It refuses a file that anyone but its owner can read, that holds fewer rules than `RULE_FLOOR`, or whose last rule is not `fw-canary`.
7. Prove the hooks: from a local `main`, `git push origin main` is refused by `pre-push`.

A clone without the private file gets exit 2 from both hooks, with these steps in the message.

### 6. GitHub repository settings (PR 2)

Settings → Actions → General ([GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)):

- Actions permissions: "Allow IHaveASegway, and select non-IHaveASegway, actions and reusable workflows". Tick "Allow actions created by GitHub"; leave "Allow Marketplace actions by verified creators" unticked; allow list `pnpm/action-setup@*, lycheeverse/lychee-action@*`.
- "Require actions to be pinned to a full-length commit SHA": off, since actions are pinned by tag. It is the switch to flip if tag pinning stops being acceptable ([delivery.md](delivery.md)).
- Workflow permissions: read access only (contents and packages). "Allow GitHub Actions to create and approve pull requests": off.

In the repository's security settings: dependency graph, Dependabot alerts and Dependabot security updates on.

When the repository goes public ([ADR 0012](adr/0012-public-repository.md)): require approval before outside contributors' fork PRs run workflows, turn on secret scanning with push protection, and add the ruleset from [ADR 0006](adr/0006-github-actions-owns-deploys.md).

### 7. Lab read token (PR 6)

The nightly `lab-objects` job lists the sandbox namespaces' objects to find state that outlived its 15-minute life ([lab.md](lab.md)). It needs read access every night, so it gets its own long-lived token rather than the deploy token: a scheduled job never holds write access.

1. Manage account → Account API tokens → Create Token → a custom token named `github-actions-lab-read`.
2. Permission: Account: Workers Scripts Read, which lab.md names for the objects API; confirm it when building. Nothing else.
3. TTL: it expires on the deploy token's end date (12 months at most), so both rotate together.
4. `gh secret set CLOUDFLARE_READ_TOKEN --repo IHaveASegway/website`. Only the `lab-objects` step reads it.

PR 6 also sets the lab route to fail closed. After the lab's first deploy creates `ihaveasegway.com/lab/api/*`, set the route's failure mode to fail closed, in the dashboard if PR 6 found that Wrangler cannot set it. Cloudflare documents no default, and fail closed keeps the upgrade signal ([cost.md](cost.md#guardrails)).

## Observability

A page view runs no Worker code, so until the lab ships there is little to observe server-side. What matters at launch: is the site up, did the deploy work, and do the links Joseph hands out convert. Allowances as of 2026-10-22:

| Signal | Tool | Answers | Free allowance | From | Source |
|---|---|---|---|---|---|
| Page views, referrers, real-user Core Web Vitals | Cloudflare Web Analytics, manual beacon | Do the shared links convert? How do real visits rate on LCP, INP and CLS (Good, Needs Improvement, Poor; the worst elements at P75)? | Free; no cookies or `localStorage`; 6 months of history. Ad blockers undercount a developer audience, so capacity decisions never use it | PR 3b | [Web Analytics](https://www.cloudflare.com/web-analytics/), [Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/) |
| Worker logs | Workers Logs (`observability.enabled`) | What did lab code do, session by session? The lab writes its own JSON lines and turns automatic invocation logs off, because those record location fields ([lab.md](lab.md)) | Until 2026-11-30: 200,000 events a day, 3-day retention. From 2026-12-01: 0.5 GB a day of ingestion and 7-day retention; at the cap, ingestion stops until 00:00 UTC, with no overage on Free | On from PR 2; asset requests run no Worker code, so the site should log little or nothing (not documented). Useful from Phase 4 | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Observability pricing](https://developers.cloudflare.com/observability/pricing/) |
| Lab usage counters | Workers Analytics Engine | How close is each demo to its daily budget? | 100,000 data points written and 10,000 read queries a day; billing not yet active | Phase 4 | [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) |
| Lab cleanup | The nightly `lab-objects` job | Did any sandbox object keep its state past its 15-minute life? | Inside the Actions minutes, about 30 a month | Phase 4 | [lab.md](lab.md) |
| Platform usage | Cloudflare dashboard, Workers and Durable Objects (DO) metrics | Worker requests a day against the 100,000 cap; DO requests, GB-s, rows written | Free | Now | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Uptime, from outside | Better Stack, free tier | Can the internet reach the site? | 10 monitors and heartbeats combined, 1 status page, email and Slack alerts, "free for personal projects". The pricing page does not state the free check interval; third-party comparisons say 3 minutes | PR 2 | [Better Stack](https://betterstack.com/pricing) |
| Deploys | The `deploy` job summary; the issue `prod-smoke` opens | Did the deploy work, and what is the rollback command? | Inside the Actions minutes | PR 2 | [delivery.md](delivery.md) |
| Zone drift | `scripts/verify-zone.sh`, weekly | Did a zone setting, a record or the registration change? | Free, token-free | PR 2 | [security.md](security.md) |
| Errors, later | Sentry, free Developer plan | Exceptions in lab Worker code | 1 user, 5k errors, 5M spans, 30-day lookback; needs `nodejs_compat` | The first lab with server logic | [Sentry](https://sentry.io/pricing/) |

Uptime monitors: the apex and `/.well-known/security.txt`, both free static assets. From Phase 4, a third can watch the lab, but it needs an endpoint that runs no DO and asks for no Turnstile token, which [lab.md](lab.md) does not define yet. At a 3-minute interval it would cost 480 Worker requests a day, under 0.5% of the Free cap. That makes three of the ten.

The runner-up is UptimeRobot's free plan: 50 monitors at a 5-minute interval, "Good for hobby and non-profit projects" ([UptimeRobot](https://uptimerobot.com/pricing/), as of 2026-10-22). Either fits. Moving between them takes minutes, so this is a two-way door decided fast.

The rule behind the uptime choice is black-box monitoring from a different failure domain: a monitor must fail independently of what it watches. Two options were rejected on that rule:

- **A GitHub Actions cron job.** Scheduled runs "can be delayed during periods of high loads", some queued jobs "may be dropped", the shortest interval is 5 minutes, and on a public repository schedules are disabled after 60 days without activity ([GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). It would also share GitHub as a failure domain with the pipeline.
- **Cloudflare Health Checks.** Not on the Free plan: as of 2026-10-22, Free has 0 checks and Pro has 10 ([Cloudflare](https://developers.cloudflare.com/health-checks/)). They would also run inside the network they report on.

## Alerting

Where alerts go is an open decision (Q26 · Q-alerts in [product.md](product.md)): email, phone push, or a chat channel. The default is email to Joseph's personal inbox, which sits outside `ihaveasegway.com` on purpose: if the domain's DNS breaks, mail to `hello@` breaks with it. Better Stack's pricing page lists email and Slack alerts on the free tier and does not say whether phone, SMS or push alerts are included, so until that is checked, "phone push" means a chat app's notifications.

| Alert | Fires when | Source | Runbook |
|---|---|---|---|
| Site down | The uptime monitor's check fails | Better Stack | [Incident: site down](#incident-site-down) |
| Deploy or `prod-smoke` failed | The job fails; `prod-smoke` also opens an issue | GitHub Actions | [Rollback](#rollback) |
| Firewall failed | `firewall` exits 1 (a finding) or 2 (cannot prove clean) | GitHub Actions | [Leak response](#leak-response) for exit 1; [access setup step 5](#5-local-hooks-and-the-private-firewall-file-pr-2) for exit 2 |
| Weekly audit failed | Zone drift, a dead external link, `security.txt` within 30 days of its `Expires`, the domain within 60 days of expiry, `compatibility_date` missing (past 180 days it only warns, in the run's log) | `scheduled.yml` | [DNS or mail change](#dns-or-mail-change), [compatibility_date bump](#compatibility_date-bump), [maintenance calendar](#maintenance-calendar) |
| Vulnerable dependency | A Dependabot alert | GitHub | [Dependency update](#dependency-update) |
| Lab cleanup bug, Phase 4 | An object with stored data on two nights running; the job opens an issue | `lab-objects` | [lab.md](lab.md); L1 for the demo until it is fixed |
| Spend, on Workers Paid only | A budget alert threshold, set on upgrade day | Cloudflare | [Upgrade to Workers Paid](#upgrade-to-workers-paid) |
| Breaker token rejected, on Workers Paid only | A breaker API call returns 401 or 403: its token expired or was revoked, so the breaker cannot trip | The cron breaker Worker | [Rotate the Cloudflare token](#rotate-the-cloudflare-token) |

Rules: every alert has a runbook, and nothing alerts that needs no action. There is no SLO at launch. A dated moment such as a talk or a launch post is when uptime starts to matter (upgrade trigger 4 in [cost.md](cost.md)), and that is the day to route the uptime alert somewhere louder than email.

## Runbooks

### Deploy

Deploys happen on merge, and on the weekly rebuild every Monday ([delivery.md](delivery.md)). There is no manual path, because the pipeline is the one writer for production.

1. Merge the PR. `ci.yml` runs on `main`: `verify`, `firewall`, `deploy`, `prod-smoke`.
2. Read the `deploy` job summary: the version that was live before, the new version id, its Version URL, and the smoke result.
3. Wait for `prod-smoke`. Green means done.
4. If the Version URL smoke failed, nothing changed: production still serves the old version. Fix forward in a new PR.
5. If the summary says "Not deployed" or "Not promoted", `main` moved on during the run. The newer commit's run deploys it; nothing needs doing.
6. If `prod-smoke` failed, follow [Rollback](#rollback). If its issue says production did not answer at all, a rollback cannot help: the custom domain is not attached, or the zone is not serving, and the issue says what to check.
7. If GitHub Actions is down, wait. New content can wait, and a broken production can be rolled back from the Cloudflare dashboard without Actions.

PR 2 only: the first deploy creates the Worker and attaches the custom domain with `wrangler deploy`, and goes live without a Version URL smoke, since the domain serves nothing yet ([delivery.md](delivery.md#deploy-verify-roll-back)). If attaching the domain failed for a missing permission (spike S7), add only the permission the error names ([access setup step 1](#1-deploy-token-pr-2)), then re-run the deploy job: it applies the routes again whenever the apex does not answer.

The lab, from Phase 4: a lab deploy drops every live WebSocket, and clients fall back to recordings. A PR that changes a DO class is merged alone and deployed alone, because a rollback cannot cross it.

### Rollback

1. Find the target. The issue `prod-smoke` opened names it, and so does the previous `deploy` job summary. Never roll back without an explicit version id ([delivery.md](delivery.md) explains why).
2. Run the rollback through the pipeline, from `main`: `gh workflow run ci.yml -f rollback_to=<version-id>`, plus `-f reason=<why>` when the reason is not "prod-smoke failed". The `rollback` job checks that the input is a version id, runs `wrangler rollback <version-id> --message "rollback: <reason>" --yes` with the scoped deploy token, waits for any deploy in progress, and `prod-smoke` follows. This is the path PR 2 rehearses.
3. If GitHub or Actions is down, use the dashboard: Workers & Pages → `ihaveasegway-web` → Deployments → ⋯ on the target version → Rollback. It runs under Joseph's login and its second factor. Never `wrangler rollback` from the laptop: it would need an edit credential at rest there.
4. Confirm `prod-smoke` passes against the rolled-back version. After a dashboard rollback, re-run the failed job: `gh run rerun <run-id> --failed`. The re-run skips the byte-for-byte check, which only the run attempt that promoted a version can make. A rollback run does not know which build is live, so it checks Home only, plus the files every release since launch serves and the `og:image` and the feed Home names, and skips the Build readout check; after a rollback to a version from before PR 3, which names no `og:image`, it reports those checks as skipped and passes.
5. Revert or fix on `main` first. The Monday rebuild skips while a rollback is live, but the next merge deploys `main` again, broken commit included.
6. Close the issue with one line: the cause, and which check would have caught it before production.

A rehearsal has nothing to fix on `main`, so it ends by deploying `main` again: re-run the `deploy` job of `main`'s last push run (`gh run rerun <run-id> --job <deploy-job-id>`). The job checks that its commit is still `main`'s tip, uploads it as a new version, smokes it, promotes it with `main@<sha>`, and its `prod-smoke` follows, so the Monday rebuild's guard re-arms without a merge. The first rehearsal, on 2026-10-23, took production from `bd499bbb` back to `dca99190` in 33 seconds, with `prod-smoke` passing against the old version; the re-run then promoted `75b0b8a5` from `main` and passed `prod-smoke`, the byte-for-byte check included.

A blocked rollback (the lab): Cloudflare refuses to roll back across a DO class change. Put the demos in recorded mode with kill-switch L1, then fix forward.

### Lab kill switch, L0–L4 (Phase 4)

Five levels, cheapest first. [lab.md](lab.md) owns the design; use the lowest level that stops the problem.

| Level | Use when | Action | Takes effect | Undo |
|---|---|---|---|---|
| L0 budget breaker | Automatic: a demo has spent its share of a Free cap, or the lab its 70% | None. `LabControl` answers `recorded` | At the next admission | Resets at 00:00 UTC |
| L1 control flag | One demo misbehaves, or its cost must stop now | Set the demo's row in `LabControl`'s `flags` table to `recorded` or `off`, with Durable Objects Data Studio in the dashboard; there is no admin endpoint ([lab.md](lab.md)) | New sessions at once; running ones end at their deadline, within 15 minutes | Set it back to `live` |
| L2 redeploy | Running sessions must end now | `gh workflow run ci.yml -f redeploy_lab=true`. Every object restarts and every socket drops | Seconds once the deploy runs, a few minutes after the dispatch | None needed: on reconnect, admission applies L0 and L1 |
| L3 WAF rule | A flood: requests must stop before they reach the Worker | Security rules page → enable the pre-built, disabled custom rule that blocks paths starting with `/lab/api/` | Seconds. That the rule runs before the Worker, and so saves quota, is likely; spike S2 tests it | Disable the rule |
| L4 route | The lab should not exist for a while | Workers & Pages → `ihaveasegway-lab` → Settings → Domains & Routes → delete `ihaveasegway.com/lab/api/*` | Minutes | Redeploy the lab, then confirm the route is set to fail closed (in the dashboard if PR 6 found Wrangler cannot set it) |

After L3 or L4, open a demo page and check that it plays its recording. A WAF block answers 403, since a custom status code needs the Pro plan ([Cloudflare](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/)), and with the route gone `/lab/api/*` reaches the site Worker's 404 page. The lab's client treats any non-2xx answer as a fallback trigger ([lab.md](lab.md)).

L4 is a dashboard change to something the config also declares, so the next lab deploy puts the route back. Then confirm the restored route fails closed, in the dashboard if PR 6 found Wrangler cannot set the mode: Cloudflare documents no default, so a re-created route is not assumed to keep it. If the route should stay off, a PR the same day removes it from `workers/lab/wrangler.jsonc`. An emergency change made outside the code has to be written back into the code, or the next deploy undoes it.

### Rotate the Cloudflare token

Planned, yearly, before the 12-month expiry. The lab read token (from Phase 4) and the cron-breaker token (after an upgrade) share the deploy token's end date and rotate in the same sitting:

1. Create a new token exactly as in [access setup step 1](#1-deploy-token-pr-2), with a new end date.
2. `gh secret set CLOUDFLARE_API_TOKEN --repo IHaveASegway/website`, and paste the new value at the prompt.
3. Exercise it: re-run the `preview` job of an open PR, or open a one-line PR.
4. Delete the old token in the dashboard.
5. From Phase 4, the lab read token: create it again as in [access setup step 7](#7-lab-read-token-pr-6), with the same new end date; `gh secret set CLOUDFLARE_READ_TOKEN --repo IHaveASegway/website`; re-run the last `lab-objects` run; delete the old token.
6. After an upgrade, the cron-breaker token: create it again with the same new end date ([Upgrade to Workers Paid](#upgrade-to-workers-paid), step 6), replace the breaker Worker's secret, confirm its next 15-minute run raises no 401 or 403 alert, and delete the old token.
7. Update the expiry date in the [maintenance calendar](#maintenance-calendar).

Suspected exposure, at any time, immediately:

1. Delete the token: Manage account → Account API tokens → ⋯ on the token → Delete. Cloudflare documents Roll only for user tokens ([roll a token](https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/)), so revoking and re-creating is the path that is certain to work. The pipeline fails until step 2.
2. Create a new token exactly as in [access setup step 1](#1-deploy-token-pr-2), then `gh secret set CLOUDFLARE_API_TOKEN` with the new value.
3. Read the account's audit log from the token's creation onward, and look for versions, deployments, routes or custom domains nobody made. With a read-only token (step 2 of access setup): `wrangler versions list --name ihaveasegway-web` and `wrangler deployments list --name ihaveasegway-web`. What goes into the incident issue is scrubbed first ([Scrubbing evidence](security.md#scrubbing-evidence)): `deployments list` prints each deployment's author email.
4. Find how the token leaked (a log, an artifact, a fork, a local file) and close that path.
5. ADR 0006's "Revisit if" fires: any incident involving the token reopens the question of who deploys.

### Rotate firewall rules

When a term is added, changed or removed. The rules never appear in an issue, a PR, a commit message or a chat.

1. Edit `~/.config/ihaveasegway/firewall.toml`. A new rule gets the next opaque id, a word boundary on both sides if it is a word, and keywords that every match contains ([rule-writing rules](security.md#rule-writing-rules)); the canary rule stays, and stays last.
2. Run `scripts/firewall/test.sh`.
3. Scan the full history with the new rules: `scripts/firewall/check.sh --history`, which prints only rule ids and locations ([security.md](security.md)). A new rule can match old commits.
4. Run `scripts/firewall/sync-secrets.sh` to update both `FIREWALL_RULES` copies.
5. If the rule count changed, set `RULE_FLOOR` in `scripts/firewall/check.sh` to the new count in a pull request: after step 4 when rules were added, and before it when rules were removed, since `sync-secrets.sh` refuses a file below the floor.
6. Update the password-manager backup.
7. Re-run `firewall` on `main` and confirm it passes. The canary proves the new rules loaded.
8. If step 3 or step 7 finds a match, go to [Leak response](#leak-response).

### Leak response

A term or a secret was pushed. The order matters: each step limits the damage the next one cannot.

1. **A secret: rotate it first.** Rewriting history does not un-leak a credential. For the Cloudflare token, use the exposure steps above.
2. **Stop serving it on the domain.** A WAF custom rule that blocks the affected path on `ihaveasegway.com` takes effect in seconds (Security rules page). Then deploy the fix, or roll back to a clean version and revert the commit on `main` the same day, then remove the rule.
3. **Stop serving it on workers.dev**, which the zone's WAF does not cover. Delete any preview that carries it (`wrangler preview delete --name pr-<n> --skip-confirmation`). Old Version URLs keep serving old versions while Version URLs are on. Turn them off in the dashboard, which takes no deploy: Workers & Pages → `ihaveasegway-web` → Settings → Domains & Routes → Version URLs → Disable ([Version URLs](https://developers.cloudflare.com/workers/configuration/previews/)). Confirm the old URL no longer answers. Deploys stop while they are off, since the smoke has no URL to test. Cloudflare's docs say neither whether a deploy with `preview_urls: true` turns them back on nor whether that re-exposes old versions, so test the old URL again after the next deploy.
4. **Private repository, never published:** the content is still in history. Rewrite it before the repository goes public; the full-history scan that [ADR 0012](adr/0012-public-repository.md) requires catches it if this step is forgotten.
5. **Public repository:** rewrite now with `git filter-repo --sensitive-data-removal` (git-filter-repo 2.47 or later), then `git push --force --mirror origin` ([GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).
6. **Ask GitHub Support** to remove cached views and the references in pull requests. They need the repository, the number of affected PRs, and the first changed commits from the filter-repo output. Support helps only where rotating a credential cannot mitigate the risk; for a name, which cannot be rotated, that is the case.
7. **Forks and clones.** GitHub cannot remove the commit from forks or from anyone's clone. List the forks (`gh api repos/IHaveASegway/website/forks`) and ask their owners. Clones persist, which is why going public is a one-way door.
8. **Outside caches.** Ask the Internet Archive and the search engines' outdated-content tools for removal, and refresh link previews wherever the URL was shared.
9. **Make it not recur.** Add or tighten the rule ([Rotate firewall rules](#rotate-firewall-rules)), run the full-history scan, and write a short note: what happened, and which control should have caught it. The note never repeats the term.

### DNS or mail change

Zone configuration lives in the dashboard. The checklist in [security.md](security.md) is its written record, and `scripts/verify-zone.sh` checks it weekly.

1. Open a PR that changes the expected value in the security.md checklist first. The PR is the change record.
2. Check the TTL of any record that resolvers cache (MX, TXT). Cloudflare's "Auto" is 300 seconds ([TTL](https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/)); for anything longer, lower it a day ahead.
3. Make the change in the dashboard.
4. Verify from outside: `scripts/verify-zone.sh`, and `dig +short <name> <type> @1.1.1.1` against `@8.8.8.8`. For mail, send a test from an outside account.
5. Merge the PR.

DNSSEC and HSTS have runbooks of their own, because a mistake in either outlives its fix.

### DNSSEC change

Turning it on, in PR 2, while the zone is empty ([ADR 0011](adr/0011-dnssec-and-hsts-ramp.md)):

1. Manage domains → `ihaveasegway.com` → Configuration → Enable DNSSEC.
2. Wait for the registry. Cloudflare submits the DS record through CDS/CDNSKEY scanning, which "can take one to two days", with no way to control the timing ([Cloudflare](https://developers.cloudflare.com/dns/dnssec/)).
3. Verify: `scripts/verify-zone.sh` finds a DS record and `"AD": true` answers, and RDAP shows `delegationSigned: true`.

A validation fault (the weekly `AD` check fails, SERVFAIL reports, DNSViz errors):

1. Confirm it is DNSSEC: `dig ihaveasegway.com @1.1.1.1` fails while `dig +cd ihaveasegway.com @1.1.1.1` resolves.
2. Fix the keys first. Switching DNSSEC off is no quick fix: resolvers keep the parent's DS record for its TTL, 86,400 seconds for .com as measured on 2026-10-22 ([ADR 0011](adr/0011-dnssec-and-hsts-ramp.md)).
3. If the keys cannot be fixed within that day, disable DNSSEC in the registrar settings, which removes the DS record, and keep zone signing on until the DS TTL has fully expired at the parent. Only then turn signing off.
4. Never toggle DNSSEC as a troubleshooting step.

### HSTS ramp step

Four steps over about five weeks after PR 2, each held at least as long as its own max-age with no HTTPS fault before the next: 300 seconds until PR 2's first deploy passes `prod-smoke`, then 1 week, 1 month, and 12 months, all with `includeSubDomains` ([ADR 0011](adr/0011-dnssec-and-hsts-ramp.md)). Each served max-age is a one-way door for its own duration.

1. Confirm the current step has been held for its full max-age, and nothing has served plain HTTP or a bad certificate in that time.
2. Nothing changes in the repository: `prod-smoke` and `scripts/verify-zone.sh` accept any step of the ramp, with `includeSubDomains` and without `preload`.
3. Steps 1 and 2 go through the API, since the dashboard starts at 1 month: a 1-day token with Zone Settings Edit ([access setup step 2](#2-short-lived-tokens-for-inspection-and-one-off-changes-as-needed)), a `PATCH` of the zone setting `security_header` whose `value.strict_transport_security` carries `enabled`, `max_age` in seconds and `include_subdomains` ([API reference](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/edit/), as of 2026-10-22), then delete the token. If the API refuses a value under a month, the ramp starts at step 3, as [ADR 0011](adr/0011-dnssec-and-hsts-ramp.md) allows. Steps 3 and 4: SSL/TLS → Edge Certificates → HSTS.
4. `curl -sI https://ihaveasegway.com/` shows the new `Strict-Transport-Security` value.
5. Put the date of the next step in the [maintenance calendar](#maintenance-calendar). Preload is not a step: it is reconsidered no earlier than 3 months after step 4, in a new ADR.

### Upgrade to Workers Paid

When one of the upgrade triggers in [cost.md](cost.md#upgrade-triggers) fires ([ADR 0008](adr/0008-workers-free-with-guardrails.md)). The order is cost.md's: the bill's guards first, then the code's.

1. Write down which trigger fired, and the evidence, in an issue, scrubbed first ([Scrubbing evidence](security.md#scrubbing-evidence)).
2. Upgrade the account to Workers Paid in the dashboard: $5 a month minimum, as of 2026-10-22 ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
3. Budget alerts at Joseph's thresholds (Q11 · Q-budget in [product.md](product.md)). They are computed daily on cumulative spend and only notify, so plan for a day's lag ([budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)).
4. A PR that adds `limits.cpu_ms` to every Worker with code ([lab.md](lab.md) has the lab's value).
5. The zone's one rate-limiting rule, on `/lab/api/*` (Security rules page).
6. The 15-minute cron breaker from ADR 0008, which reads usage and enables the L3 rule above a threshold. Its API token is a Worker secret, scoped to reading analytics and editing that one zone's rules; confirm the exact permissions when building, and update its row in the [secrets inventory](security.md#secrets-inventory). Give the token the deploy token's end date, so it rotates with the others, and have the breaker alert when an API call returns 401 or 403, so an expired or revoked token cannot leave it silently unable to trip.
7. Record the date and the trigger in ADR 0008's "Revisit if" review.

### compatibility_date bump

Quarterly per Worker, or when a feature needs a newer date.

1. Read the compatibility flags dated between the Worker's current date and today ([compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)).
2. Branch, and change only `compatibility_date` in that Worker's `wrangler.jsonc`.
3. CI, the preview and `e2e` must pass; for the lab, the workerd tests too.
4. Merge and watch `prod-smoke`. The date is part of the version, so a rollback undoes it.

### Dependency update

Every other Monday, about 15 minutes; security updates as they arrive.

1. Dependabot opens one grouped PR for minor and patch versions, one for actions, and one per major after its 14-day cooldown ([delivery.md](delivery.md)). It runs weekly, and the grouped PRs wait for the next sitting. A major is a pull request of its own, planned like any other ([roadmap.md](roadmap.md)).
2. Skim the changelogs of anything in the deploy path: Wrangler, Astro, pnpm, the actions.
3. CI green: merge. For an Astro or Tailwind update, look at the preview too.
4. Install fails on release age (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, a lockfile entry younger than a day): re-run after 24–48 hours. If it cannot wait, add the exact version to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, with a comment giving the date, the reason and a removal date no more than 7 days out, and remove it on that date.
5. A diff that adds `minimumReleaseAgeExclude` entries nobody wrote: pnpm adds them itself when a local install picks a version younger than a day ([delivery.md](delivery.md)). Give each the same dated comment, or wait a day and re-install without it.
6. A Dependabot lockfile that rewrites large parts of the file (quoting style, ordering): its pnpm 11 support is new (2026-10-20), so the first four runs get a close review. If Dependabot fails on the lockfile more than twice in a month, switch to Renovate.
7. TypeScript 7 stays out through the `ignore` rule until typescript-eslint and `@astrojs/check` accept it; check their peer ranges quarterly.
8. Security updates skip the cooldown: merge as soon as CI passes.
9. Never hand-edit the lockfile.

### Incident: site down

1. Confirm from outside: `curl -sS -o /dev/null -w '%{http_code}\n' https://ihaveasegway.com/` from the laptop, and load the site on a phone off Wi-Fi.
2. Check [Cloudflare's status page](https://www.cloudflarestatus.com/). If an incident covers Workers or the region, there is nothing to roll back: wait, and note it in an issue.
3. Read the response: `curl -sI https://ihaveasegway.com/`. A 404 on every path points at the last deploy. A TLS error points at the certificate. A name that does not resolve points at DNS or DNSSEC: compare `dig ihaveasegway.com @1.1.1.1` with `dig +cd ihaveasegway.com @1.1.1.1`. If only the `+cd` query (checking disabled) resolves, DNSSEC validation is failing.
4. Check the last deploy: `gh run list --workflow ci.yml --branch main --limit 3`. If the failure started with it, [roll back](#rollback).
5. If nothing changed on this side and Cloudflare is green, check the registration (RDAP, access setup step 2) and the account's audit log for recent zone changes.
6. Afterwards, a short blameless note in an issue: the timeline, the cause, how it was detected, and the check that would have caught it sooner. Command output and screenshots in it are scrubbed first ([Scrubbing evidence](security.md#scrubbing-evidence)).

## Zone configuration: when it moves to code

Zone settings stay in the dashboard, with the checklist in [security.md](security.md) and the weekly token-free audit, until one of these triggers fires:

- more than about 25 managed zone objects;
- a second zone;
- Cloudflare Access apps, or WAF custom rules beyond the lab's kill rule;
- a second person or agent editing the zone;
- the weekly audit catching unplanned drift more than once a quarter.

Then: OpenTofu with Cloudflare's provider v5, state in R2, the existing settings imported with `cf-terraforming`, plan on the PR and apply on merge, with a zone-scoped token held only by that job. Pulumi in TypeScript is the alternative; it bridges the same v5 provider. Below the triggers, infrastructure as code would be more code to run than settings it protects: about twenty settings that change a few times a year.

## Maintenance calendar

Each row carries an estimate of the minutes it costs a month, with quarterly and yearly work spread over its months, so the plan can be checked against the 2-hour target in [product.md](product.md). The sum leaves out incidents, the one-off HSTS ramp, and framework majors, which arrive as pull requests of their own and draw on building time ([roadmap.md](roadmap.md)). The 3-month time log in product.md catches whatever the estimate misses.

| When | Task | How | Minutes a month |
|---|---|---|---|
| Weekly, Monday | Zone audit (DNS, TLS, registration), external links, `security.txt` expiry, `compatibility_date` age | Automatic (`scheduled.yml`); a failure emails | 0 while green |
| Weekly, Monday | Rebuild and redeploy `main`, which proves it still builds and deploys from scratch. Its first reason, keeping GitHub facts at most a week old ([ADR 0004](adr/0004-content-as-code.md)), went with the facts step on 2026-10-23 | Automatic (`ci.yml` schedule); a failure emails | 0 while green |
| Every other Monday | Dependabot's grouped PRs; security updates as they arrive | [Dependency update](#dependency-update), about 15 minutes a sitting | 32 |
| Weekly, from Phase 4 | `LabControl`'s ledger against the account's metered usage; metered above the ledger means the per-session ceilings are wrong | Cloudflare dashboard ([lab.md](lab.md)), about 10 minutes | 43, until PR 6 changes it |
| Nightly, from Phase 4 | `lab-objects`: sandbox state that outlived its 15 minutes | Automatic; an issue on a finding | 0 while green |
| After PR 2, about 5 weeks | The HSTS ramp: 300 s, 1 week, 1 month, 12 months | [HSTS ramp step](#hsts-ramp-step) | Once: about an hour in all |
| Monthly | One sitting: Actions minutes used (above 1,500 of the 2,000, the deploy owner is revisited, [ADR 0006](adr/0006-github-actions-owns-deploys.md)); Worker requests (the site should be near zero) and, from Phase 4, DO usage; real-user LCP, INP and CLS against the limits in [design-system.md](design-system.md), read the way PR 3b settles ([delivery.md](delivery.md)); firewall false positives (more than one a month: tighten the rules); once the repository is public, its traffic view ([ADR 0012](adr/0012-public-repository.md)) | GitHub billing and traffic pages, Cloudflare dashboard, Web Analytics | 15 |
| Monthly | A web search for the site and for Joseph's name, looking for anything the firewall should have caught | By hand | 5 |
| Monthly | `git bundle create website.bundle --all`, kept with personal backups; GitHub is otherwise the only remote copy ([security.md](security.md)) | By hand | 3 |
| Quarterly | `compatibility_date` bump per Worker | [Runbook](#compatibility_date-bump), about 30 minutes a Worker | 10; 20 from Phase 4 |
| Quarterly | What Dependabot does not watch: the gitleaks release, whether `@lhci/cli` still releases, TypeScript 7 readiness in the peer ranges, and from Phase 4 PartyServer (0.x). A major that waited for its x.1 (Astro) arrives as its own pull request | Release pages, peer ranges | 5 |
| Quarterly | Cloudflare members and API tokens; GitHub tokens, SSH keys and authorized apps. Delete anything unused. Also the zone's AI-crawler setting, which the token-free audit cannot read ([security.md](security.md)) | Dashboards | 5 |
| Quarterly | Export the zone with `cf-terraforming` and a 7-day read-only token, kept outside the repo; copy any analytics numbers worth keeping into the repo, since Web Analytics keeps 6 months | By hand ([security.md](security.md)) | 7 |
| Quarterly | ADR "Revisit if" triggers | [ADR index](adr/README.md) | 10 |
| Quarterly | Compare `profile.json`'s title, role names and years with LinkedIn, and edit by hand (Q-title, [ADR 0004](adr/0004-content-as-code.md)) | By hand | 2 |
| When Cloudflare's changelog announces a pricing or limits change | Re-check the affected rows of the price sheet in [cost.md](cost.md); a full pass once a year | The changelog's [RSS feed](https://developers.cloudflare.com/changelog/rss/index.xml) | 8 |
| Yearly, 30 days before the deploy token's end date (set in PR 2) | Rotate the deploy token, the lab read token (Phase 4) and the cron-breaker token (after an upgrade), which share its end date | [Rotate the Cloudflare token](#rotate-the-cloudflare-token) | 3 |
| Yearly, before `Expires` | Move `security.txt`'s `Expires` forward, keeping it under a year out ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116.html)); the weekly job fails at 30 days | A PR | 1 |
| Yearly, before 2027-09-18 | Domain: auto-renew is on and the registration expires 2027-10-18 (as found on 2026-10-22). Cloudflare's first renewal attempt comes about 30 days before expiry and charges the primary card only. Confirm auto-renew is still on and the card is valid | Dashboard, [RDAP](https://rdap.verisign.com/com/v1/domain/ihaveasegway.com) | Under 1 |
| Yearly | GitHub and Cloudflare recovery codes are offline and readable, each hardware key still signs in, and the primary and recovery emails on both accounts are personal addresses ([security.md](security.md)) | By hand | 2 |
| Yearly | The Node LTS line (26 is supported until 2029-04-30) and the toolchain pins in [delivery.md](delivery.md) | Release schedules | 2 |
| At any job change | The primary and recovery emails on GitHub and Cloudflare are personal addresses | Account settings | — |
| **Before the lab** | | | **About 110: 1 h 50 min** |
| **Added from Phase 4, by hand** | The weekly reconciliation and a second `compatibility_date` bump | | **About 53** |

Before the lab the plan fits the target with about 10 minutes to spare, which is thin; the time log decides. Three cuts got it there:

- **Dependabot's grouped PRs are merged every other Monday, not weekly.** Security updates still merge as soon as CI passes. The trade: routine updates can wait a week longer, and each merge carries two weeks of changes.
- **The price sheet is re-checked when Cloudflare's changelog announces a change**, plus one full pass a year, instead of a full pass every quarter.
- **The quarterly upgrade slot shrank** to the tools Dependabot does not watch. A framework major gets its own pull request, counted in the roadmap's building time.

One suggested cut was not taken: folding the zone export into the weekly audit would put a Cloudflare token into a job that is token-free by design ([security.md](security.md)). From Phase 4 the lab adds about 53 minutes by hand, which would put the total near 2 h 45 min. PR 6 has to bring it back under the target or change product.md's target with the time log as evidence ([roadmap.md](roadmap.md)). Automating the reconciliation lands at about 2 h; doing it monthly by hand still leaves about 2 h 10 min. Counting the minutes is the point: a budget that nothing is checked against is not a budget.

## Patterns and further reading

Canonical sources are collected in [reading-list.md](reading-list.md).

- **Least privilege and fail-safe defaults:** the four-permission token, the 7-day inspection token, exit 2 when the rules are missing. Jerome Saltzer and Michael Schroeder, "The Protection of Information in Computer Systems" (1975).
- **Black-box monitoring from another failure domain, and alerts that each demand an action:** *Site Reliability Engineering* (Google, 2016), ch. 6, "Monitoring Distributed Systems".
- **Toil, the work the runbooks and the calendar keep small:** the same book, ch. 5, "Eliminating Toil".
- **Runbooks and incident handling:** the same book, ch. 14, "Managing Incidents".
- **Blameless incident notes:** the same book, ch. 15, "Postmortem Culture: Learning from Failure".
- **Kill switch as an operations toggle:** Pete Hodgson, "Feature Toggles (aka Feature Flags)" (martinfowler.com, 2017).
- **Circuit breaker and load shedding:** Michael Nygard, *Release It!*, 2nd ed. (2018), ch. 5, "Stability Patterns".
- **Emergency changes written back into code (configuration drift):** Martin Fowler, "InfrastructureAsCode" (bliki).
- **Secret handling and rotation:** OWASP, "Secrets Management Cheat Sheet".
