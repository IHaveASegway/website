# ADR 0003: Astro, static-first, zero JavaScript by default

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

The site has two audiences ([product.md](../product.md)): recruiters, who give Home about seven seconds, and engineers and hiring managers, who read case studies, decisions and posts. Both arrive mostly through links Joseph hands out, so the first reader of a page is often a link unfurler or a crawler that reads only the HTML. Nearly every page is text. The exception is the lab (Phase 4), where a demo console needs real interactivity. Hosting serves files and runs no code on a page view ([ADR 0002](0002-host-on-workers-static-assets.md)). Workers Free allows 10 ms of CPU per request and server rendering typically takes 10 to 20 ms, so rendering at request time is out either way.

Joseph's daily stack is React 19, TanStack Router and Query, Vite, TypeScript and Tailwind v4. The framework should reuse it where interaction is needed and stay out of the way everywhere else. The budgets in [design-system.md](../design-system.md) are concrete: eager JS of 5 KB gzip or less on content pages, p75 LCP of 2.5 s or less, INP of 200 ms or less.

JavaScript per page, measured 2026-10-22 (gzip, minimal apps; method and full table in [stack.md](../stack.md)): an Astro text page ships 0 KiB. One React 19 island adds 69.5 KiB to its own page only; one Preact island adds 9.4 KiB; a vanilla web component, 0.3 KiB. TanStack Start ships 106.7 KiB and React Router 8.5 ships 111.6 KiB to every page, text pages included. A Vite and React SPA ships 66.2 KiB to every page, with an empty HTML body.

Astro, as of 2026-10-22:

- `astro` 7.4.2 was published 2026-10-21. Majors shipped on 2024-12-03 (5.0), 2026-03-10 (6.0) and 2026-06-22 (7.0). Astro 7 replaced the compiler with a Rust rewrite (unclosed tags are now errors) and made Sätteri the default Markdown processor (existing remark and rehype plugins run only through the `unified()` fallback until ported). ([npm](https://www.npmjs.com/package/astro), [upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v7/))
- Cloudflare acquired The Astro Technology Company on 2026-01-16. Astro "stays open-source and MIT-licensed", its "open governance and current roadmap remain in place", and it "continues to support a wide set of deployment targets, not just Cloudflare". ([Astro](https://astro.build/blog/joining-cloudflare/))
- Cloudflare's Astro guide: "If you want to use Astro as a static site generator, you do not need the Astro Cloudflare adapter." ([guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/))
- The framework research bench found three traps with the adapter on an all-static build. Prerendering runs in workerd, where resvg's native binary fails to load, so build-time OG images fail. The default image service provisions a Cloudflare Images binding. A custom Worker entry is silently dropped when every route is prerendered. None of the three applies without the adapter.
- The same bench built 300 MDX posts with Expressive Code in 1.72 s, and OG images at a median of 65 ms each in Node.
- Astro's built-in CSP (`security.csp`, added in 6.0) hashes scripts and works with MDX, Expressive Code and islands, provided inline style attributes are allowed (`style-src-attr 'unsafe-inline'`, which Expressive Code's token colors need). It does not support `<ClientRouter />`. ([configuration reference](https://docs.astro.build/en/reference/configuration-reference/#securitycsp))

## Decision

- **Astro 7**, with `astro` pinned exactly on the 7.4 line (7.4.2 today), building static output with `trailingSlash: 'always'` and `build.format: 'directory'` ([ADR 0005](0005-url-scheme.md)).
- **No Cloudflare adapter at launch.** Prerendering runs in Node, the output goes to `dist/`, and Wrangler serves it as assets. Add `@astrojs/cloudflare` only if the site Worker ever needs an on-demand route; the bulkhead plan keeps dynamic work in the lab Worker instead.
- **Zero JavaScript by default.** A page or component ships 0 KB of JS unless it opts in. On content pages the only opt-ins are vanilla modules (the effects and the ⌘K palette, about 0.3 to 1.2 KB gzip each), under the 5 KB eager budget that CI enforces; no framework runtime loads there. React 19 islands appear only on lab pages where a demo console needs them. Posts contain no `client:*` directives. This is the islands architecture (partial hydration); sources are in [reading-list.md](../reading-list.md).
- **Content**: MDX content collections with Zod-validated front matter ([ADR 0004](0004-content-as-code.md)), Expressive Code for code blocks, `@astrojs/rss` and `@astrojs/sitemap`. MDX stays thin: at most 5 shared components.
- **Navigation**: the browser's native cross-document view transitions, not `<ClientRouter />`. They need no JS. Chrome 126+ and Safari 18.2+ animate them; Firefox, which MDN's compatibility data lists as unsupported, navigates normally (progressive enhancement).
- **Styling and fonts**: Tailwind CSS 4.3.x with tokens as CSS custom properties ([ADR 0010](0010-quiet-console-design-tokens.md)), and no shadcn on content pages. Fonts are self-hosted: Inter Variable and a JetBrains Mono subset, 64,120 B together.
- **OG images** at build time, with satori and resvg.

Sketch — confirm against current docs when building.

```js
// apps/web/astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://ihaveasegway.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // No adapter: static output, prerendered in Node, served as Worker assets.
  integrations: [
    expressiveCode(), // must come before mdx()
    mdx(),
    react(), // islands on lab pages only
    sitemap(),
  ],
  vite: { plugins: [tailwindcss()] },
  // CSP: security.md. Fonts through the Fonts API's local provider: design-system.md.
});
```

```css
/* apps/web/src/styles/global.css (excerpt) */
@media (prefers-reduced-motion: no-preference) {
  @view-transition { navigation: auto; }
}
```

## Alternatives considered

The measured JS above is the latency evidence for each option.

- **TanStack Start 1.x** (runner-up). Joseph's daily router and data layer, one router for the site and the demos, type-safe server functions, and an official Cloudflare guide whose custom server entry can export Durable Object (DO) classes. It trades latency and bytes per visitor for evolvability on app-like features: 106.7 KiB on every page, text included. Maturity is lower: 1.0 was declared stable on 2026-10-13. It has no content layer, so MDX collections, feeds, sitemap and OG images would be built by hand, the opposite of composing proven parts. Rejected for now. It is the first choice for an app-like lab on its own path.
- **React Router 8, framework mode.** Full-stack React, a worker entry the app owns, yearly majors. 111.6 KiB on every page; Cloudflare's starter template is still on 7.9.6 and breaks on v8 until migrated; no content layer; and a second router to learn beside TanStack Router. It trades latency for familiarity it only partly delivers.
- **Next.js via vinext or OpenNext.** The largest ecosystem. Cloudflare's recommended path, vinext, "is in beta", and OpenNext is for existing apps ([Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)). Server components and full hydration bring a new model with nothing to gain on a text site, and rendering per request does not fit Free's 10 ms of CPU. It trades operability and cost predictability for ecosystem breadth.
- **SvelteKit 3.** A small runtime and good latency. Its Cloudflare adapter cannot export DO classes ([adapter docs](https://svelte.dev/docs/kit/adapter-cloudflare)), it is a new language, and 3.0 shipped on 2026-10-01. It gains latency and loses evolvability for a team of one: nothing from his stack transfers.
- **Hugo or Zola.** 0 KiB by default, millisecond builds, a single binary. No islands (Hugo's React example renders on the client), a template language of its own, and a second toolchain beside npm for anything interactive. Best on latency and operability for pure text; weakest on evolvability once the lab arrives.
- **A Vite and React SPA**, the Mission-AI pattern. No new concepts. It ships 66.2 KiB before the first word, serves crawlers and unfurlers an empty root, and needs MDX, feeds, sitemap, OG images and prerendering rebuilt by hand with pre-1.0 plugins. This is the weaker design: it trades latency, discoverability and maintenance for familiarity, and it builds what already exists.
- **Astro with the Cloudflare adapter from day one.** No benefit for a static site, and the three traps above. Deferred until an on-demand route exists.
- **Astro with React islands for the effects and the palette.** One React island on Home costs 69.5 KiB, about 14 times the 5 KB budget, for a palette the vanilla version does in 1.18 KB. Rejected.

Prior art for this shape:

- developers.cloudflare.com is built with Astro: 8,431 pages, whose build Astro 7 cut from 386.89 s to 261.94 s ([Astro 7 announcement](https://astro.build/blog/astro-7/)). It deploys from GitHub Actions with a Worker Preview per pull request ([cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs)).
- The Guardian's dotcom-rendering records partial hydration in [ADR 026, "Improved Partial Hydration"](https://github.com/guardian/dotcom-rendering/blob/main/dotcom-rendering/docs/architecture/026-better-partial-hydration.md): the page renders on the server, and only components marked as islands hydrate. Its [ADR 019, "Moving from React to Preact"](https://github.com/guardian/dotcom-rendering/blob/main/dotcom-rendering/docs/architecture/019-react-to-preact.md), cut the bundle from about 93 KB to 66 KB, the same lever as the Preact runner-up for islands in [stack.md](../stack.md).

## Consequences

Good:

- Text pages ship no framework JS. Their eager JS is about 2.2 KB of vanilla modules (2,172 B as one bundle, [design-system.md](../design-system.md)): the palette, the label decode and the telemetry strip on every content page, plus the draw fallback on `/colophon/`.
- Joseph keeps React 19, shadcn, Tailwind and TypeScript for the parts that need them. The new concepts are `.astro` files and `client:*` directives; [stack.md](../stack.md) lists what to read.
- Feeds, sitemap, OG images and fonts are produced at build time. Nothing runs at request time, so there is nothing to keep running.
- Content stays portable: Markdown, thin MDX and CSS tokens.

Bad:

- Churn. Three majors between 2024-12-03 and 2026-06-22, and v7 changed both the compiler and the Markdown pipeline (Sätteri is 0.x). Mitigation: exact pins, grouped Dependabot PRs, and majors adopted at their x.1 release ([stack.md](../stack.md)).
- Vendor concentration. Cloudflare owns the framework and the host, and also runs the DNS, the edge and the lab runtime. One company's strategy now moves two layers at once. Mitigation: no adapter, so the site carries no Cloudflare-specific code; the output is static; content is in git; and the MIT license allows a fork.
- Each island is its own React root. Context does not cross islands; shared state needs a small store such as Nano Stores.
- No `<ClientRouter />`: no elements persist across navigations (`transition:persist`), and Firefox gets plain navigation.
- Astro does not hash `is:inline` scripts, so the theme's pre-paint script needs its hash in `astro.config`, computed at build from the inlined file. CSP is not enforced in `astro dev`; the e2e run against each preview is where it gets tested ([security.md](../security.md)).

## Door

Two-way, with a medium exit cost. Markdown content and CSS tokens move to any generator. `.astro` templates and island wiring do not, which is days of work for about 10 pages. MDX stays portable only while posts use at most 5 shared components and no `client:*` directives. The one-way part is the URL scheme ([ADR 0005](0005-url-scheme.md)), and it does not depend on the framework.

## Revisit if

- More than a third of pages need a React island. Full hydration would then cost only 37 to 42 KiB more per page than one island (106.7 or 111.6 against 69.5) and bring app ergonomics, so move the app-like parts to TanStack Start.
- A demo needs state that survives navigation, such as a persistent console.
- An Astro major takes more than one day to adopt, or breaks the build path for more than two weeks.
- Real-user p75 LCP exceeds 2.5 s, or INP exceeds 200 ms, on text pages. Where that p75 comes from is settled in PR 3, because Web Analytics' docs do not say whether it reports one site-wide ([delivery.md](../delivery.md)).

## Postscript 2026-10-23

The typefaces under **Styling and fonts** changed with the design direction chosen on 2026-10-23: Instrument Sans and JetBrains Mono, self-hosted from PR 3 after spike S9 ([ADR 0010](0010-quiet-console-design-tokens.md), [design-system.md](../design-system.md#chosen-direction)). Until then the site uses system font stacks. The rest of the decision stands, and no Revisit if condition was met.
