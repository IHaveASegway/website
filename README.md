# ihaveasegway.com

Source for [ihaveasegway.com](https://ihaveasegway.com): Joseph Peterson's site. It shows his work and how he decides, and it will host his writing and a small lab of live demos.

**Status:** planning. Nothing is deployed yet. This first change is the design, written down before any code.

- [docs/README.md](docs/README.md) is the index and gives a reading order.
- [docs/product.md](docs/product.md) covers why the site exists, who it is for, and the open decisions.
- [docs/architecture.md](docs/architecture.md) covers the shape, data ownership and failure modes.
- [docs/roadmap.md](docs/roadmap.md) lists what gets built, in which pull request, and when it counts as done.
- [docs/adr/](docs/adr/README.md) holds the architecture decision records. All are Proposed until accepted in review.

## Shape, in one paragraph

The site is static. Astro builds it, and an assets-only Cloudflare Worker serves it, so no code runs on a page view and a busy day costs nothing. Interactive demos come later. They live in a separate Worker backed by Durable Objects, so a popular or abused demo cannot take the site down. GitHub Actions is the only thing that deploys. A content check runs before every deploy and fails closed.

## Working here

- One branch per change and one pull request at a time. Nothing goes to `main` directly.
- Every decision that is hard to reverse gets an ADR in `docs/adr/`.
- Local setup, commands and CI arrive with the scaffolding pull request. See [docs/delivery.md](docs/delivery.md).
