# ihaveasegway.com

Source for [ihaveasegway.com](https://ihaveasegway.com): Joseph Peterson's site. Astro builds it as static files and an assets-only Cloudflare Worker serves them, so a page view runs no code and costs nothing. GitHub Actions is the only thing that deploys: each change is built once, checked (format, lint, types, fitness functions, and a content firewall that fails closed), previewed, smoke-tested on Cloudflare's edge, and only then promoted. Interactive demos come later, in a separate Worker, so a busy demo cannot take the site down.

**Status:** Home v1 (PR 3) is built in design direction C, "Instrument", in Petrol + Apricot, set as a poster on 2026-10-24: the self-hosted typefaces, the theme toggle, link previews and structured data, with its byte, contrast, fold, theme and motion budgets enforced in CI. No page describes how the site is built ([design-system.md](docs/design-system.md#nothing-on-the-page-describes-the-site)). Writing (PR 5) is built and appears with the first published post; none is yet. Project cards are built too, and each waits on its readiness check. What comes next, and what blocks it, is in [docs/roadmap.md](docs/roadmap.md).

- [docs/README.md](docs/README.md) is the index and gives a reading order.
- [docs/product.md](docs/product.md) covers why the site exists, who it is for, and the open decisions.
- [docs/architecture.md](docs/architecture.md) covers the shape, data ownership and failure modes.
- [docs/roadmap.md](docs/roadmap.md) lists what gets built, in which pull request, and when it counts as done.
- [docs/adr/](docs/adr/README.md) holds the architecture decision records.

## Setup

1. **Node 26**, from `.nvmrc` (`nvm use`).
2. **pnpm, pinned by `packageManager`.** Any pnpm switches itself to 11.28.6 in this repository; with none installed, `npx pnpm@11.28.6` does the same. Then `pnpm install`.
3. **The hooks**, once per clone: `git config core.hooksPath .githooks`. `pnpm install` warns until they are on. The pre-commit hook runs the content firewall on staged changes and checks your commit identity; the pre-push hook refuses pushes to `main` and scans what you push.
4. **The private rules file** at `~/.config/ihaveasegway/firewall.toml`, mode 600, backed up in the password manager ([operations.md](docs/operations.md), access setup, step 5). Without it both hooks refuse with exit 2. It is never committed, and its terms are never written anywhere else.
5. Optional: `pnpm --filter web exec astro telemetry disable`. CI disables Astro's telemetry, and `wrangler.jsonc` turns off Wrangler's.

## Commands

| Command                                              | What it does                                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | Astro's dev server at http://localhost:4321                                                                                                                                       |
| `pnpm build`                                         | Builds the site into `apps/web/dist/`                                                                                                                                             |
| `pnpm test`                                          | Fitness functions: token contrast, URL scheme, Worker config, color literals. Build first: `pnpm build`, `pnpm --filter web build:preview` and `pnpm --filter web build:fixtures` |
| `pnpm e2e`                                           | Playwright against `wrangler dev` serving `dist/`; build first, and install Chromium once                                                                                         |
| `pnpm --filter web serve`                            | `wrangler dev` at http://127.0.0.1:8787: `dist/` with the `_headers` rules production applies                                                                                     |
| `pnpm lint`, `pnpm typecheck`                        | ESLint and `astro check`                                                                                                                                                          |
| `pnpm format`, `pnpm format:check`                   | Prettier                                                                                                                                                                          |
| `pnpm firewall:test`                                 | The content firewall's self-test, with throwaway rules                                                                                                                            |
| `scripts/firewall/check.sh --history`                | A full-history firewall scan, after any rule change                                                                                                                               |
| `scripts/verify-zone.sh`                             | The zone audit: DNS, DNSSEC, TLS, HSTS, redirects, mail records, registration                                                                                                     |
| `pnpm --filter web icons`                            | Renders the raster icons from `public/favicon.svg`                                                                                                                                |
| `pnpm --filter web exec playwright install chromium` | Chromium for the e2e suite, once per machine                                                                                                                                      |

## Deploy and roll back

**Deploy:** merge the pull request. CI builds once, runs the firewall, uploads a version that takes no traffic, smoke-tests its Version URL, promotes it to 100%, then checks production through the zone.

**Roll back:** `gh workflow run ci.yml -f rollback_to=<version-id>`, with the id from the incident issue or the deploy summary. If GitHub is down, use the dashboard's Rollback ([operations.md](docs/operations.md), "Rollback").

## License

The code is MIT-licensed ([LICENSE](LICENSE)). The writing and images are © 2026 Joseph Peterson, all rights reserved.
