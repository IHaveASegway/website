# ADR 0010: Quiet Console tokens, copied rather than imported

Status: Proposed · 2026-10-22 · Deciders: Joseph Peterson

## Context

The site needs a design language that a recruiter can read in a few seconds, that passes WCAG 2.2 AA in both themes, and that is recognizably Joseph's. [design-system.md](../design-system.md) describes the whole system. This ADR decides where the token values come from and who owns them.

Two pieces of his own work already define a look:

- **Mission-AI's console UI**, his earlier project: shadcn's zinc neutrals and token names on Tailwind, Inter and JetBrains Mono, 11px uppercase labels, metric tiles. The part this site needs is about 100 lines of CSS. It is published in Mission-AI's private, scoped npm packages on GitHub Packages, marked `UNLICENSED`, and installing them in CI needs a personal access token with `read:packages`.
- **gitops' terminal UI**: Lip Gloss ANSI colors (86 `#5fffd7` for the accent and cursor, 214 `#ffaf00` for warnings), a `▸` cursor, `✓` and `✗`, facts joined by ` · `, and a README release badge in `#00c2a8`.

Neither works as-is. Measured on 2026-10-22:

- Mission-AI has no brand accent: its dark `primary` is white. Its focus ring renders at 1.21:1 in light and 1.47:1 in dark, against the 3:1 that SC 1.4.11 requires, although its style guide claimed AA. Its tokens are bare oklch triplets, a Tailwind v3-era workaround that v4 makes unnecessary.
- gitops' accent `#5fffd7` is ΔE_OK 0.0054 from `#64ffda`, the green of Brittany Chiang's v4 portfolio template ([bchiang7/v4](https://github.com/bchiang7/v4): 8,286 stars and 4,203 forks as of 2026-10-22). One just-noticeable difference is 0.02 ([CSS Color 4](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)), so to the eye they are the same color.
- Two gitops colors fail AA as text on the terminal's `#171717`: ANSI 241 (`#626262`, 2.94:1) and ANSI 196 (`#ff0000`, 4.48:1).

The repository is likely to become public ([ADR 0012](0012-public-repository.md)), so every value in it must be safe to publish and licensed for it.

**Reopened on 2026-10-22.** Joseph confirmed that the Mission-AI values are his to reuse (Q25 · Q-token-owner in [product.md](../product.md#decided)). He also asked for a look that is distinctive rather than what everyone else ships: creative, but not distracting. Zinc neutrals with Inter are the default of a great many developer sites built on shadcn, so the values in the Decision below are a starting point, not the answer. A design exploration before PR 3 puts three directions on Home's real wireframe. Joseph picks one, and this ADR is rewritten with its values and then Accepted, together with Q17. What stands either way: one token file owned by this repository, copied rather than imported, semantic token names, full `oklch()` values, the CI contrast test and the focus rule. PR 2 ships that structure with placeholder values and system fonts.

## Decision

Copy the token values into this repository as a deliberate fork. Nothing depends on Mission-AI's packages.

- **One file owns the tokens**: `apps/web/src/styles/tokens.css`. It keeps shadcn's token names, so lab islands that use shadcn components need no mapping, and it stores full `oklch()` values instead of triplets.
- **Neutrals**: Mission-AI's zinc. Eight of the sixteen neutral values are steps of Tailwind's public zinc scale (MIT); the others are tuned for contrast.
- **One accent**, derived from the gitops badge `#00c2a8` (ΔE_OK 0.072 from it, 0.109 from the template green): dark `oklch(0.80 0.13 178)` `#43d9be`, 11.20:1 on the background; light `oklch(0.52 0.09 182)` `#0e7a6d`, 5.03:1.
- **One amber signal**: dark `oklch(0.82 0.15 75)` `#fcb442`, 11.12:1; light `oklch(0.56 0.13 55)` `#ad5c15`, 4.66:1.
- **gitops' raw ANSI 86 appears only inside always-dark terminal panels**, with two fixes: dim becomes `#929292` (5.76:1) and red becomes `#fc5855` (5.68:1).
- **Focus is a 2px solid outline in the accent**: 11.20:1 dark, 5.03:1 light. Mission-AI's ring is not carried over.
- **A CI test owns the contrast claim**, as a fitness function. It reads `tokens.css`, converts each value with culori, checks every text and non-text token against every surface in both themes, and checks that every value is inside sRGB. All 25 declared pairs pass in both themes today. The full cross product finds one failure, light `signal` on `surface-2` at 4.42:1, which [design-system.md](../design-system.md) handles as a forbidden pair; if signal text is ever needed there, darkening the light value to `oklch(0.55 0.13 55)` (4.61:1) fixes it in one line.
- **Provenance lives in this ADR, not in a CSS comment.** A comment can survive into the built CSS, and Mission-AI is not on the site at launch.

## Alternatives considered

- **Import the private preset.** Add Mission-AI's scoped packages as a dependency. Gains: one source for both projects, so a fix in one reaches the other (evolvability). Costs: a long-lived token with `read:packages` in CI to fetch 100 lines of CSS (security); builds and Dependabot runs that depend on a private registry and its credentials (operability, availability); an `UNLICENSED` package referenced from a public repository that no one else can build (evolvability); and two repositories writing the same values, which is a second owner (consistency). Rejected.
- **The Geist look**: Vercel's Geist and Geist Mono, and its grid aesthetic. Gains: the smallest font pair measured (52,528 B), a polished system, OFL. Costs: Geist Mono lacks `▸ ■ ✓ ✗ ⌘` even in the full build of geist 1.8.2 ([npm registry](https://registry.npmjs.org/geist), as of 2026-10-22), so gitops' grammar breaks; and the pair reads as Vercel's, a template signal on a portfolio. Rejected. The hero grid borrows Geist Grid's crosses without the fonts.
- **A new palette from scratch**, generated from a few inputs with no lineage. Gains: no ownership question; a clean derivation. Costs: design time; it drops the point that the brand is built from his own tools; and it needs the same contrast work anyway. Kept as the fallback if ownership cannot be confirmed: the neutrals can be re-derived from Tailwind's zinc scale (MIT) in about an hour.
- **Arwes**, the canonical sci-fi web UI framework. Gains: an instant cyber look. Costs: its README says "The ARWES project is no longer maintained and currently outdated" and that it "does not work with React strict mode nor React Server Components"; `@arwes/react` 1.0.0-next.25020502 (2025-02-05) peers React 18 ([github.com/arwes/arwes](https://github.com/arwes/arwes), as of 2026-10-22); 27.3 KB plus React on every page against a 5 KB eager budget; and it reads as a game UI. Rejected.
- **gitops' ANSI 86 as the site accent.** Gains: direct continuity with gitops. Costs: ΔE_OK 0.0054 from the template green. Rejected; it stays inside terminal panels.
- **Amber as the lead color** (Q17 · Q-accent in [product.md](../product.md)). Viable: no template overlap, strong on dark. Teal is recommended because it ties the site to the gitops badge; amber stays the single signal color. Joseph decides before PR 3.

Prior art. "A little copying is better than a little dependency" is one of Rob Pike's [Go Proverbs](https://go-proverbs.github.io/) (2015). shadcn/ui is built on the same idea: "This is not a component library. It is how you build your component library", and it "hands you the actual component code" instead of a package to import ([shadcn/ui](https://ui.shadcn.com/docs), as of 2026-10-22). Linear generates its themes in LCH from three inputs (base color, accent color, contrast) instead of 98 variables per theme ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), 2024-03-28); this set is small enough to tune by hand, but the few-inputs idea shapes the high-contrast variant. Stripe's ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems) is the precedent for making contrast part of how colors are chosen, which here means a test.

## Consequences

- **Divergence from Mission-AI is accepted.** Nothing syncs in either direction. If Mission-AI is revived and wants these values, the direction reverses: this repository publishes, and Mission-AI imports or copies.
- **Joseph confirmed on 2026-10-22 that he is the sole owner of the Mission-AI token values** (Q25 · Q-token-owner in [product.md](../product.md#decided)), so the chosen direction may reuse any of them.
- **Recognition starts accumulating at launch.** The accent is on every link, focus outline, OG image and screenshot, so changing it after launch is a rebrand.
- **The contrast test is load-bearing.** A token edit that breaks AA fails `verify`. That is how this design avoids the silent failure Mission-AI's focus ring shows.
- **About 100 lines of CSS are maintained by hand**, with no upstream fixes. Acceptable at this size.
- **This ADR names Mission-AI**, which is not on the site at launch (Q24 · Q-mission). Rendering an ADR on the site is opt-in ([ADR 0001](0001-record-architecture-decisions.md)), and this one stays unrendered until Joseph decides.

## Door

Two-way for the token values. They are CSS custom properties in one file, a swap is a one-file pull request, and the contrast test guards it. Two-way for copy versus import: if a second consumer appears, this repository publishes a public package; `packages/` is created only once a second consumer exists ([delivery.md](../delivery.md)).

The accent hue is effectively one-way over time. Recognition accumulates in people's memory, in screenshots, OG images and slides, and none of that can be recalled. Settle Q17 before launch (PR 3); after launch, an accent change is a rebrand with its own ADR.

## Revisit if

- The contrast test fails on a proposed token change, or axe or a manual VoiceOver or NVDA pass finds a contrast failure in a real component.
- Three of five recruiter or peer reviewers call the look "templated", "gimmicky" or "hard to read", or name a template (Brittany Chiang's v4, Vercel's Geist).
- Mission-AI is revived and needs the same tokens: publish them from here instead of copying twice.
- Light mode collects more defects than dark in the first three months after launch, a sign the dark-first design shortchanges the theme a recruiter on a light-mode laptop sees first.
