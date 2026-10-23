# ADR 0006: GitHub Actions owns build, gates and deploys

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

The site is static files served by an assets-only Worker ([ADR 0002](0002-host-on-workers-static-assets.md)). Something has to build them, check them, and publish them, both as a preview for each pull request and as new production versions. Two facts about the repository shape the choice:

- `IHaveASegway/website` is a private repository on a GitHub Free personal account. There, the rulesets and branch-protection APIs returned 403 when queried on 2026-10-22, "Upgrade to GitHub Pro or make this repository public to enable this feature", and "Users with GitHub Free plans can only configure environments for public repositories" ([rulesets API](https://docs.github.com/en/rest/repos/rules#get-all-repository-rulesets), [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)). So "changes reach `main` only through a pull request" and "required checks" cannot be enforced on the server today, and environment secrets and deployment protection rules do not exist.
- Two systems could write to the Worker. One is GitHub Actions, with a Cloudflare API token stored in GitHub. The other is Workers Builds, Cloudflare's CI behind its GitHub app: no secret in GitHub, a production deploy on every push to the production branch, and a preview build for every other branch ([Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)).

Two principles in [product.md](../product.md) constrain the choice: one pipeline and one writer per environment, and fail closed on content. The second means the content firewall passes before anything is published, previews included, because a preview is public the moment it exists ([ADR 0007](0007-content-firewall.md)).

Prior art. Cloudflare's own documentation site, Astro on Workers, deploys from GitHub Actions rather than Workers Builds. Its workflows, read on 2026-10-22, run `wrangler preview --name … --tag … --message …` for each pull request, take the URLs Wrangler reports from `WRANGLER_OUTPUT_FILE_PATH` instead of building them by hand, and deploy production from a concurrency group that never cancels ([ci.yml](https://github.com/cloudflare/cloudflare-docs/blob/production/.github/workflows/ci.yml), [publish-production.yml](https://github.com/cloudflare/cloudflare-docs/blob/production/.github/workflows/publish-production.yml)). Netlify's [Deploy Previews](https://docs.netlify.com/site-deploys/deploy-previews/) made a preview per pull request the expected pattern; Worker Previews, launched 2026-09-22, bring it to Workers.

## Decision

1. GitHub Actions owns build, gates, previews and deploys. Workers Builds stays disconnected.
2. The gate is the job graph. `preview` and `deploy` `needs:` `verify` and `firewall`, and `firewall` runs before `preview`. This works on a private Free repository because it depends on no branch protection. A local `pre-push` hook refuses pushes to `main`.
3. When the repository is public ([ADR 0012](0012-public-repository.md)), add a ruleset: a pull request is required, and `verify`, `firewall` and `e2e` are required checks.
4. One deploy credential: an account-owned API token (`cfat_`) with Account: Workers Scripts Edit and Account Settings Read; Zone `ihaveasegway.com`: Workers Routes Edit and Zone Read; a 12-month expiry. It is stored as the repository secret `CLOUDFLARE_API_TOKEN`, and the account ID, an identifier rather than a credential, as the repository secret `CLOUDFLARE_ACCOUNT_ID`, so GitHub masks it in logs. That this set can attach the custom domain is likely, not tested: spike S7 ([roadmap.md](../roadmap.md)).
5. Rollbacks run through the pipeline too, as a `workflow_dispatch` job with the same token, so no edit credential ever sits on a laptop. The dashboard's Rollback button is the break-glass path for when GitHub is down. It can only point traffic back at a version the pipeline already uploaded.
6. Never both. If Workers Builds is ever connected, the same pull request deletes every Actions job that writes to Cloudflare (`preview`, `preview-cleanup`, `deploy`, `rollback`), so production keeps one writer (the single-writer principle, [reading-list.md](../reading-list.md)).

The pipeline is specified in [delivery.md](../delivery.md); token setup, rotation and the runbooks are in [operations.md](../operations.md).

## Alternatives considered

As of 2026-10-22:

| | A. Actions owns it (chosen) | B. Workers Builds deploys; Actions as required checks | C. Both connected | D. Manual `wrangler` from the laptop |
|---|---|---|---|---|
| Only green, firewall-clean code is published, on a private Free repository | Yes, through `needs:` | No: required checks need a public repository or GitHub Pro | No | No |
| The firewall passes before a preview exists | Yes | No: its docs describe no way to wait for GitHub checks, so the preview builds on the push, beside CI | No | No |
| Cloudflare credential held outside Cloudflare | One scoped account token, in GitHub | None in GitHub. Cloudflare generates a user token with Workers Scripts, KV and R2 Edit, and Workers Routes Edit on all zones | Both | An edit credential at rest on a laptop |
| Writers to production | 1 | 1 | 2 | 1, unrecorded |
| Where the pipeline's logic lives | Workflow files | Workflow files, plus build settings in the dashboard | Both | Shell history |
| Free allowance | 2,000 Actions minutes a month on a private repository, free on a public one; this pipeline uses about 865, about 1,312 in a busy month, as measured on 2026-10-23 ([delivery.md](../delivery.md)) | 3,000 build minutes a month | | |

- **B** is the better design once its gate exists. It keeps the Cloudflare secret out of GitHub and comes with pull-request comments and check runs. Without required checks, every push to `main` deploys whatever CI reports. Even with them, nothing in Workers Builds' docs makes a preview wait for GitHub checks, so a failing firewall would block the merge but not the preview. That matters while the repository is private; once it is public, the push has already published the content. Its build settings live in the dashboard, a second place to read when something breaks. B trades content safety (a public preview before the firewall) and operability (two systems) for one fewer secret in GitHub.
- **C** is two writers to one version history. Deploys race, the last one wins, and the rollback list interleaves two sources. It is multi-leader replication with last-write-wins, and it has the same conflicts.
- **D** has no gate and no record, and needs a broad credential at rest on a laptop. It trades every quality attribute for the absence of YAML.

Sources: [Workers Builds configuration and its generated token](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Workers Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [GitHub plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans).

## Consequences

Good:

- One pipeline to read when something breaks. Every publishing job uses the artifact `verify` built, so the bytes the firewall scanned are the bytes that ship.
- The gate holds today, private or public, without a paid plan.
- Every merge deploys, and the exact version is smoke-tested on Cloudflare's edge before it takes traffic ([delivery.md](../delivery.md)).

Bad:

- "Only green code is published" holds; "only reviewed code reaches `main`" does not, until the ruleset exists. A push with `--no-verify`, or an edit in GitHub's web editor, still lands on `main`, but it cannot deploy without `verify` and `firewall`. While the repository is private, a push to `main` is not publication, so the property that matters holds. Once it is public, a push is publication, which is why ADR 0012 adds the ruleset.
- A long-lived Cloudflare token lives in GitHub. What bounds it:
  - scope: four permissions on one account and one zone, with no DNS, zone settings or user permissions;
  - time: a 12-month expiry, rotated 30 days early ([operations.md](../operations.md));
  - exposure: only the steps that run Wrangler see it; jobs that hold it run only GitHub-created actions and `pnpm/action-setup`, and Wrangler comes from the lockfile;
  - reach: Dependabot runs and fork pull requests never receive it, so `preview` is skipped for Dependabot.
- Residual risk: as a repository secret, any workflow on any branch can read it. Environments would not shrink its power, because previews need the same token on pull-request branches and a Cloudflare token cannot be limited to previews. Scope and expiry are the real limits. What a leaked token could do is in [architecture.md](../architecture.md).
- This repository owns two small jobs that a managed CI would otherwise run: the preview comment, modeled on Cloudflare's own workflow, and preview cleanup when a pull request closes.
- From Phase 4, the lab's nightly object check needs read access every night. It gets a separate read-only token rather than this one, so a scheduled job never holds write access ([operations.md](../operations.md)).
- The pipeline spends Actions minutes: about 865 of the 2,000 included each month on a private Free repository, about 1,312 in a busy month, as measured on 2026-10-23 ([delivery.md](../delivery.md) has the model). With no payment method on file, usage is blocked at the quota rather than billed. A public repository pays nothing.

## Door

Two-way. Moving to Workers Builds means connecting the repository in the dashboard and merging one pull request that deletes the jobs that write to Cloudflare: under a day. Deployed versions stay in Cloudflare's history either way, and revoking the token cuts GitHub off in seconds. It is written down anyway because it decides where the deploy credential lives and what has to pass before anything is published.

## Revisit if

- Actions usage passes 1,500 minutes a month on a private repository.
- Any incident involves the token: a leak, or a version, deployment or route that no Actions run explains.
- The repository is public with required checks, and keeping a deploy token in GitHub has become the bigger risk than splitting the pipeline across two systems.

## Postscript 2026-10-23

The pipeline PR 2 built differs in two places from "every merge deploys, and the exact version is smoke-tested on Cloudflare's edge before it takes traffic" ([delivery.md](../delivery.md#deploy-verify-roll-back)):

- A run deploys only while its commit is `main`'s tip. Runs queue in arrival order and a re-run can come days later, so when merges land close together, only the newest one's run deploys.
- The first deploy creates the Worker and attaches the domain with `wrangler deploy`, and goes live without a Version URL smoke, because the domain serves nothing yet; `prod-smoke` checks it. Until then `preview` publishes nothing, because `wrangler preview` would create the Worker itself, without its domain.

The decision stands, and no Revisit if condition was met.
