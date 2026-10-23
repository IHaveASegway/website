# ADR 0010: Direction C's tokens, owned here and copied rather than imported

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

Rewritten in PR 3, while still Proposed, for the direction chosen on 2026-10-23, as [ADR 0001](0001-record-architecture-decisions.md) allows. The file name is frozen, so it keeps the name of the design language this record first proposed.

## Context

The site needs a design language that a recruiter can read in a few seconds, that passes WCAG 2.2 AA in both themes, and that is recognizably Joseph's. [design-system.md](../design-system.md) describes the whole system. This ADR decides where the token values come from, who owns them, and which direction they draw.

PR 1 proposed Quiet Console, built from two pieces of his own work:

- **Mission-AI's console UI**, his earlier project: shadcn's zinc neutrals and token names on Tailwind, Inter and JetBrains Mono, 11px uppercase labels, metric tiles. The part this site needs is about 100 lines of CSS. It is published in Mission-AI's private, scoped npm packages on GitHub Packages, marked `UNLICENSED`, and installing them in CI needs a personal access token with `read:packages`.
- **gitops' terminal UI**: Lip Gloss ANSI colors (86 `#5fffd7` for the accent and cursor, 214 `#ffaf00` for warnings), a `▸` cursor, `✓` and `✗`, facts joined by ` · `, and a README release badge in `#00c2a8`.

Neither worked as-is. Measured on 2026-10-22:

- Mission-AI has no brand accent: its dark `primary` is white. Its focus ring renders at 1.21:1 in light and 1.47:1 in dark, against the 3:1 that SC 1.4.11 requires, although its style guide claimed AA. Its tokens are bare oklch triplets, a Tailwind v3-era workaround that v4 makes unnecessary.
- gitops' accent `#5fffd7` is ΔE_OK 0.0054 from `#64ffda`, the green of Brittany Chiang's v4 portfolio template ([bchiang7/v4](https://github.com/bchiang7/v4): 8,286 stars and 4,203 forks as of 2026-10-22). One just-noticeable difference is 0.02 ([CSS Color 4](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)), so to the eye they are the same color.
- Two gitops colors fail AA as text on the terminal's `#171717`: ANSI 241 (`#626262`, 2.94:1) and ANSI 196 (`#ff0000`, 4.48:1).

On 2026-10-22 Joseph confirmed that the Mission-AI values are his to reuse (Q25 · Q-token-owner in [product.md](../product.md#decided)), and asked for a look that is distinctive rather than what everyone else ships: creative, but not distracting. Zinc neutrals with Inter are the default of a great many developer sites built on shadcn. So a design exploration drew three directions on Home's real wireframe, at 1440 px and 390 px, in both themes: A "Drawing Set", B "Field Notes" and C "Instrument". On 2026-10-23 he picked C, then Petrol + Apricot from four color studies of it (Q17 · Q-accent).

The repository is likely to become public ([ADR 0012](0012-public-repository.md)), so every value in it must be safe to publish and licensed for it.

## Decision

Direction C, "Instrument", in Petrol + Apricot, with its token values owned by this repository: a deliberate copy of a structure, with no dependency on Mission-AI's packages.

- **One file owns the tokens**: `apps/web/src/styles/tokens.css`. It keeps shadcn's token names, so lab islands that use shadcn components need no mapping, and it stores full `oklch()` values instead of triplets. It is the only file in `apps/web/src` allowed to hold a color value.
- **Neutrals: petrol.** Dark background `oklch(0.233 0.035 225)` `#08212a`; light background `oklch(0.981 0.007 220)` `#f4fafc`. No Mission-AI value remains: C replaced the zinc neutrals and the accent, and kept the names and the structure.
- **One accent: apricot.** Dark `oklch(0.84 0.095 60)` `#f9bc8b`, 9.99:1 on the background; light `oklch(0.52 0.126 48)` `#a14e1b`, darkened to text contrast, 5.49:1. `--signal` and `--ring` point at it, so there is no second color to keep in step.
- **Type**: Instrument Sans, for its width axis, and a JetBrains Mono subset for labels and readouts; OFL 1.1, self-hosted, 64,140 B together ([design-system.md](../design-system.md#typography)).
- **Focus is a 2px solid outline in the accent**: 9.99:1 in dark and 5.49:1 in light on the background, and at least 7.81:1 and 4.66:1 on every surface. Mission-AI's ring is not carried over.
- **A CI test owns the contrast claim**, as a fitness function. `test/tokens.test.ts` reads `tokens.css`, converts each value with culori, checks every text token at 4.5:1 and every non-text token at 3:1 against every surface in both themes, checks each accent fill's label, and checks that every value is inside sRGB. The full cross product passes with no forbidden pair; the tightest pairs are 4.66:1 for text and 3.14:1 for a border, both on light `surface-2`.
- **gitops' raw ANSI colors appear only inside terminal recordings** (PR 4), with two fixes: dim becomes `#929292` (5.76:1) and red becomes `#fc5855` (5.68:1).
- **Provenance lives in this ADR, not in a CSS comment.** A comment can survive into the built CSS, and Mission-AI is not on the site at launch.

## Alternatives considered

- **Quiet Console, as PR 1 proposed it**: Mission-AI's zinc neutrals, a teal accent derived from the gitops badge (`#43d9be` in dark), an amber signal, and a HUD of hairline grids, corner brackets, LEDs and scanlines. Gains: built from his own tools; all 25 declared token pairs passed; a full design existed. Costs: zinc with Inter reads as the shadcn default, which is the opposite of what Joseph asked for; the teal sat 0.109 from the template green; about 2.2 KB of eager JavaScript for its effects; and the full cross product found one failing pair (light signal on `surface-2`, 4.42:1). Replaced by C.
- **Directions A, "Drawing Set", and B, "Field Notes"**, the exploration's other two boards, drawn on the same wireframe in both themes. The boards were judged by eye, not scored, so this record keeps the choice and the evidence that would overturn it (Revisit if) rather than a ranking.
- **C's other color studies**: Graphite + Cobalt, Ink + Chartreuse, Paper + Swiss red, and C's first palette of graphite and orange, which Joseph turned down together with a crop-mark card hover. Petrol + Apricot won. Every study kept the same token names, so the choice was a one-file change.
- **Import the private preset.** Add Mission-AI's scoped packages as a dependency. Gains: one source for both projects, so a fix in one reaches the other (evolvability). Costs: a long-lived token with `read:packages` in CI to fetch 100 lines of CSS (security); builds and Dependabot runs that depend on a private registry and its credentials (operability, availability); an `UNLICENSED` package referenced from a public repository that no one else can build (evolvability); and two repositories writing the same values, which is a second owner (consistency). Rejected, and moot once C replaced the values.
- **The Geist look**: Vercel's Geist and Geist Mono, and its grid aesthetic. Gains: the smallest font pair measured (52,528 B), a polished system, OFL. Costs: Geist Mono lacks `▸ ■ ✓ ✗ ⌘` even in the full build of geist 1.8.2 ([npm registry](https://registry.npmjs.org/geist), as of 2026-10-22); and the pair reads as Vercel's, a template signal on a portfolio. Rejected.
- **Arwes**, the canonical sci-fi web UI framework. Gains: an instant cyber look. Costs: its README says "The ARWES project is no longer maintained and currently outdated" and that it "does not work with React strict mode nor React Server Components"; `@arwes/react` 1.0.0-next.25020502 (2025-02-05) peers React 18 ([github.com/arwes/arwes](https://github.com/arwes/arwes), as of 2026-10-22); 27.3 KB plus React on every page against a 5 KB eager budget; and it reads as a game UI. Rejected.
- **gitops' ANSI 86 as the site accent.** Gains: direct continuity with gitops. Costs: ΔE_OK 0.0054 from the template green. Rejected; it stays inside recordings.

Prior art. "A little copying is better than a little dependency" is one of Rob Pike's [Go Proverbs](https://go-proverbs.github.io/) (2015). shadcn/ui is built on the same idea: "This is not a component library. It is how you build your component library", and it "hands you the actual component code" instead of a package to import ([shadcn/ui](https://ui.shadcn.com/docs), as of 2026-10-22). Linear generates its themes in LCH from three inputs (base color, accent color, contrast) instead of 98 variables per theme ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), 2024-03-28); this set is small enough to tune by hand, but the few-inputs idea shapes the more-contrast variant. Stripe's ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems) is the precedent for making contrast part of how colors are chosen, which here means a test.

## Consequences

- **Divergence from Mission-AI is complete.** No value is shared, and nothing syncs in either direction. If Mission-AI is revived and wants these values, this repository publishes, and Mission-AI imports or copies.
- **Recognition starts accumulating at launch.** The accent is on every focus outline, the primary button, the section numbers, the Open Graph image and every screenshot, so changing it after launch is a rebrand.
- **The background alone does not set the site apart.** Petrol sits ΔE_OK 0.033 from the template's navy `#0a192f`, under two just-noticeable differences; the apricot accent (0.212 from its green), the condensed type and the visible grid carry the distinction ([design-system.md](../design-system.md#distance-from-the-template-look)).
- **The contrast test is load-bearing.** A token edit that breaks AA fails `verify`. That is how this design avoids the silent failure Mission-AI's focus ring shows.
- **About 190 lines of CSS are maintained by hand**, with no upstream fixes, and the light values are written twice, once for a stored choice and once for the OS, with a test that keeps the copies equal. `light-dark()` would remove the copy once it is Baseline widely available.
- **This ADR names Mission-AI**, which is not on the site at launch (Q24 · Q-mission). Rendering an ADR on the site is opt-in ([ADR 0001](0001-record-architecture-decisions.md)), and this one stays unrendered until Joseph decides.

## Door

Two-way for the token values. They are CSS custom properties in one file, a swap is a one-file pull request, and the contrast test guards it. Two-way for copy versus import: if a second consumer appears, this repository publishes a public package; `packages/` is created only once a second consumer exists ([delivery.md](../delivery.md)).

The accent hue is effectively one-way over time. Recognition accumulates in people's memory, in screenshots, Open Graph images and slides, and none of that can be recalled. Q17 settled it before launch; from here, an accent change is a rebrand with its own ADR.

## Revisit if

- The contrast test fails on a proposed token change, or axe or a manual VoiceOver or NVDA pass finds a contrast failure in a real component.
- Home fails the 7-second test ([product.md](../product.md)), or three of five recruiter or peer reviewers call the look "templated", "gimmicky", "distracting" or "hard to read", or name a template (Brittany Chiang's v4, Vercel's Geist).
- Mission-AI is revived and needs the same tokens: publish them from here instead of copying twice.
- Light mode collects more defects than dark in the first three months after launch, a sign the dark-first design shortchanges the theme a recruiter on a light-mode laptop sees first.

## Postscript 2026-10-23

The terminal recordings this record mentions were dropped on 2026-10-23, with the case studies they belonged to ([design-system.md](../design-system.md)). gitops' ANSI colors, and the two fixes named for them, have no use until a recording ships. Nothing else changes, and no Revisit if condition was met.
