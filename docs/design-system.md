# Design system: Instrument

Instrument is how ihaveasegway.com looks and moves: a Swiss-style 12-column frame with a ruler across the top, a poster-size condensed name, and a mono readout row of facts read from the build, in petrol and apricot. Its "cyber" feel comes from structure and real data, not from neon, glitch or sound. This doc owns the tokens, the palette and its measured contrast, typography, the motifs, motion, the effects catalog, the design budgets, the accessibility rules and the layout of Home. Why the tokens are a copy owned by this repository, and how the direction was chosen, is [ADR 0010](adr/0010-quiet-console-design-tokens.md). Home's sections and copy belong to [content.md](content.md); the policy that admits the theme script belongs to [security.md](security.md); where each check runs belongs to [delivery.md](delivery.md).

Status: Updated in PR 3 (Home v1) · 2026-10-23

Units: 1 KB = 1,000 bytes. JS and CSS sizes are minified and gzip -9 unless stated. Figures dated 2026-10-23 come from PR 3's build, and the checks below re-measure them on every pull request. Figures dated 2026-10-22 come from the research prototypes and say so.

## Chosen direction

Chosen on 2026-10-23 (Q17 in [product.md](product.md#decided)). The exploration drew three directions on Home's wireframe, at 1440 px and 390 px, in both themes: A "Drawing Set", B "Field Notes" and C "Instrument". Joseph picked C, and then Petrol + Apricot from four color studies of it; Graphite + Cobalt, Ink + Chartreuse, Paper + Swiss red, and C's first palette of graphite and orange lost. Cards keep the hover he preferred: a 2 px accent bar that sweeps across the card's top edge, rather than corner crop marks.

What C is, as PR 3 built it:

- **A 12-column frame with a ruler.** The frame is 1,312 px of content inside 64 px margins: `max-width: 90rem` on a border-box element, so the padding counts inside it. Phones get 18 px margins. A numbered tick band across the top of every page marks the columns the layout sits on, four of them on a phone. It is decoration, hidden from assistive technology.
- **A poster-size name.** 156 px at 1440 px and 66 px at 390 px and below, a ratio of 2.36, inside the 2.5 the type scale allows. It is set at 80% width. At 66 px the condensed name's longest word, "Peterson", is 206 px wide, so it fits the 284 px a 320 px screen leaves, and the fitted fallback faces keep that true before the font arrives. Under the name, one row holds the title and location, a line of proof, and the actions.
- **A readout row.** Facts about the build in mono, read from the build itself: the commit, the build date and the JavaScript shipped. It is Home's telemetry strip.
- **One accent.** Apricot fills the primary button, draws focus, the location dot, the section and principle numbers and the card bar, and colors a link on hover. Otherwise links read as text with an underline at 3:1, so the underline, not the color, marks them (SC 1.4.1). `--signal` and `--ring` point at the accent.
- **Type.** Instrument Sans, whose width axis runs from 75% to 100% and gives the condensed name, and JetBrains Mono for labels and readouts; both OFL 1.1, self-hosted ([Typography](#typography)).
- **Cards react only when they lead somewhere.** A card that holds a link shows the bar and a stronger border on hover, and `:focus-within` mirrors it for the keyboard. A card with nothing to activate stays still, because a reaction would promise a click that does nothing.

**Icons.** Chosen on 2026-10-23 from five options on the design canvas. The favicon is a generic self-balancing scooter seen from the front: two wheels and a T handlebar, apricot on a petrol tile, legible at 16 px. The 180 px touch icon, which iOS and iMessage show, is a rider on the scooter, which needs about 44 px to read, so tabs keep the front view. Both are drawn for this site, not taken from a maker's logo (Q21 in [product.md](product.md)). `public/favicon.svg` and `apps/web/icons/touch-icon.svg` are the sources; `pnpm --filter web icons` renders `favicon.ico` and `apple-touch-icon.png` from them. The touch icon is a full-bleed square, because iOS rounds the corners itself and fills transparency with black.

**Forced colors.** A Windows contrast theme replaces the button's apricot fill with the user's background but keeps the label's own color, which axe measured at 1.02:1. So under `forced-colors: active` the primary button takes system colors (`ButtonFace`, `ButtonText`). The readout row draws its rules with the row's background showing through 1 px gaps, and forced colors paint every background in `Canvas`, so each readout draws its own `CanvasText` outline there. System color keywords are the one kind of color allowed outside `tokens.css`.

## Why

- Recruiters give the page seconds and engineers give it a minute ([content.md](content.md) has the evidence). A slow, hard-to-read or templated page contradicts what the site says about its author, so speed and accessibility are requirements here, not polish.
- The ask was a "cyber" feel. The need is evidence. Structure earns its place only where it shows something real: the commit that built the page and the JavaScript it shipped (principle 6 in [product.md](product.md)).
- If nothing is done, the site gets shadcn's stock look, which reads as a template, or a sci-fi skin that delays the first word.

## Options considered

The exploration compared rendered boards, by eye, not a scored matrix: three directions on Home's real wireframe, then four color studies of the one Joseph picked. The strategic options around it:

| Option | Bytes and latency | Accessibility | Recognition | Upkeep | Verdict |
|---|---|---|---|---|---|
| **C. Instrument**: Swiss grid with a ruler, poster name, readout row; Petrol + Apricot | 624 B of eager JS (the theme script, measured 2026-10-23); fonts 64,140 B | the full cross product passes AA in both themes ([Measured contrast](#measured-contrast)) | a grid made visible and a condensed poster name, unlike the shadcn default most developer sites share | one token file, no effect modules | **Chosen** |
| Quiet Console, the starting point PR 1 planned: Mission-AI's zinc neutrals, a teal accent, a HUD of hairline grids, corner brackets, LEDs and scanlines | about 2.2 KB of eager JS for its launch effects (research, 2026-10-22); fonts 64,120 B | all 25 declared pairs passed; one undeclared pair failed (light signal on surface-2, 4.42:1) | built from his own tools, but zinc with Inter is the default of a great many shadcn sites, and its teal sat 0.109 from a well-known template's green | one token file; four vanilla modules behind flags | Replaced on 2026-10-23 |
| Sci-fi skin: Arwes, neon, looping glitch, boot screen | Arwes is 27.3 KB plus React; LCP waits on the boot animation | looping motion needs controls under SC 2.2.2 and risks SC 2.3.1 | reads as a game UI | Arwes says it is no longer maintained | Rejected |
| A known look: Vercel's Geist, or teal on navy with numbered headings (Brittany Chiang's v4 template) | smallest fonts (the Geist pair is 52.5 KB) | fine | reads as someone else's | low | Rejected |
| Plain text: system fonts, no motifs | best: close to 0 KB of JS, no font bytes | best | forgettable; ignores the brief | lowest | Fallback |

Plain text is what principle 1 alone would pick, and it stays the fallback: every motif in C is CSS that can be removed without breaking a page. C spends 64 KB of fonts and some design time to answer the brief with real data instead of decoration. Door: two-way for everything except the accent hue ([ADR 0010](adr/0010-quiet-console-design-tokens.md)).

Evidence that C was wrong: field p75 mobile LCP above 2.5 s, INP above 200 ms or CLS above 0.1; axe, VoiceOver or NVDA failures; Home fails the 7-second test ([product.md](product.md)); three of five recruiter or peer reviewers call it "gimmicky" or "hard to read", or name a template.

## Data the design system touches

[architecture.md](architecture.md) owns the site-wide table. This is the slice the design system reads or writes.

| Datum | System of record | Writer | Readers | How it crosses | Consistency needed |
|---|---|---|---|---|---|
| Token values | `apps/web/src/styles/tokens.css` | Joseph, by PR | every component; the contrast test; the Open Graph card, which reads the same values at build (`src/lib/tokens.ts`) | build (CSS, and the PNG) | exact per deploy |
| Theme choice | the visitor's browser (`localStorage` key `theme`) | the visitor, through the toggle | the pre-paint script, the only code that reads or writes the key; it sets `data-theme` and `data-saved` on `<html>`, and CSS picks the toggle's label from those | never leaves the browser | per browser |
| Nav manifest | `apps/web/src/lib/nav.ts`, filtered at build to the pages the build writes | Joseph, by PR (the list); the build (which items exist) | header, footer; the palette from PR 4 | build | exact per deploy |
| Build commit, build date, JavaScript bytes | git and the CI run; `src/lib/weights.ts` measures the bytes | CI, at build | the readout row on Home, the footer's build line on other pages, the card for this site | written into the HTML at build | exact for that build |
| Serving data center ("colo") | none: Cloudflare's edge derives it per request | Cloudflare | deferred to PR 4 (the served-from readout) | — | — |

Mission-AI's packages are not an upstream: no sync, no second owner. The weaker design imports them, and two repositories then write the same values.

## Lineage

C replaced Quiet Console, the design language PR 1 planned, on 2026-10-23. The structure stayed and the look changed:

| | Quiet Console (planned in PR 1) | Instrument (built in PR 3) |
|---|---|---|
| Neutrals | Mission-AI's zinc, hue about 286 | petrol, hue 205 to 231 |
| Accent | teal from the gitops badge, plus an amber signal | apricot, one accent; the signal is the accent |
| Type | Inter Variable and a JetBrains Mono "HUD" subset with box drawing | Instrument Sans with its width axis, and a small JetBrains Mono subset |
| Structure | hairline grid, corner brackets, LEDs, scanlines, a terminal panel in the hero | a 12-column frame, a ruler, rules between rows, a readout row |
| Data on the page | a telemetry strip with the serving data center | the readout row: commit, build date, JavaScript; the data center is deferred |

What carried over unchanged: one token file with shadcn's semantic names in full `oklch()` values, copied rather than imported ([ADR 0010](adr/0010-quiet-console-design-tokens.md)); the contrast test over the full cross product; the budgets; the accessibility rules; no-motion-first; mono labels that carry facts. Mission-AI's own audit is why the contrast claim is a CI test and not a comment: its focus ring rendered at 1.21:1 in light and 1.47:1 in dark, against the 3:1 SC 1.4.11 asks for, while its style guide claimed AA.

## Palette

Dark-first, light fully supported, following the OS by default ([Theme before first paint](#theme-before-first-paint)). One accent; everything else is neutral.

### Tokens

| Token | Role | Dark | Light |
|---|---|---|---|
| `--background` | page | `oklch(0.233 0.035 225)` `#08212a` | `oklch(0.981 0.007 220)` `#f4fafc` |
| `--surface-1` | panels: the readout row, cards | `oklch(0.272 0.041 225)` `#0c2b36` | `oklch(0.951 0.011 211)` `#e7f1f3` |
| `--surface-2` | a step above: hover, the skip link | `oklch(0.31 0.044 225)` `#143541` | `oklch(0.925 0.014 212)` `#dce9ec` |
| `--foreground` | body text | `oklch(0.961 0.01 205)` `#ebf4f5` | `oklch(0.219 0.03 231)` `#0a1d26` |
| `--muted-foreground` | secondary text and labels | `oklch(0.8 0.025 216)` `#adc2c8` | `oklch(0.471 0.03 225)` `#495f68` |
| `--subtle-foreground` | the ruler's numbers | `oklch(0.72 0.03 218)` `#90aab1` | `oklch(0.505 0.03 222)` `#526971` |
| `--border` | decorative rules and the ruler only | `oklch(0.431 0.04 223)` `#375560` | `oklch(0.861 0.015 213)` `#c7d4d7` |
| `--input` | functional borders and link underlines (3:1) | `oklch(0.6 0.035 220)` `#69868f` | `oklch(0.6 0.03 220)` `#6d858d` |
| `--primary` | the accent | `oklch(0.84 0.095 60)` `#f9bc8b` | `oklch(0.52 0.126 48)` `#a14e1b` |
| `--primary-strong` | accent on hover | `oklch(0.88 0.068 62)` `#f9ceaa` | `oklch(0.46 0.115 46)` `#8a3f15` |
| `--primary-foreground` | text on an apricot fill | `oklch(0.2 0.029 60)` `#201308` | `oklch(0.991 0.005 211)` `#f8fdfe` |
| `--signal`, `--ring` | attention, the focus outline | `var(--primary)` | `var(--primary)` |
| `--destructive` | errors | `var(--foreground)`, until a page shows an error state | the same |

The light accent is apricot darkened to text contrast on the light surfaces. In shadcn's vocabulary `accent` is a hover surface, not the brand color; the brand color is `--primary`. The names stay shadcn's, so lab islands that use shadcn components ([ADR 0003](adr/0003-astro-static-first.md)) need no mapping.

### Measured contrast

Method: OKLCH to OKLab to linear sRGB ([Ottosson's matrices](https://bottosson.github.io/posts/oklab/)), then WCAG 2.2 [relative luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance), with [culori](https://culorijs.org/api/) 4.0.2. Every token is inside the sRGB gamut, so no browser clips it. `test/tokens.test.ts` computes the full cross product from `tokens.css` on every pull request: every text token against every surface at 4.5:1, every non-text token at 3:1, and the label on each accent fill. The values below are from 2026-10-23, dark / light.

| Token | Need | on background | on surface-1 | on surface-2 |
|---|---|---|---|---|
| foreground (also `destructive`, for now) | 4.5 | 14.92 / 16.39 | 13.29 / 15.03 | 11.65 / 13.91 |
| muted-foreground | 4.5 | 8.98 / 6.38 | 8.00 / 5.85 | 7.02 / 5.42 |
| subtle-foreground | 4.5 | 6.78 / 5.51 | 6.04 / 5.05 | 5.30 / 4.68 |
| primary (also `signal` and the focus `ring`) | 4.5 | 9.99 / 5.49 | 8.90 / 5.03 | 7.81 / 4.66 |
| primary-strong | 4.5 | 11.46 / 7.09 | 10.21 / 6.50 | 8.96 / 6.01 |
| input (borders, underlines) | 3.0 | 4.27 / 3.70 | 3.80 / 3.40 | 3.34 / 3.14 |

On the accent fills: `primary-foreground` on `primary` measures 10.91 / 5.65, and on `primary-strong` 12.51 / 7.29. `border` is decoration and carries no claim (2.09 / 1.44 on the background); it is still checked for gamut.

Every pair passes in both themes, and the test lists no forbidden pair. The tightest text pairs are 5.30:1 in dark (`subtle-foreground` on `surface-2`) and 4.66:1 in light (`primary` on `surface-2`); the tightest non-text pair is `input` on `surface-2` in light, 3.14:1. The test also fails when a color token has no declared role, and when the light block for a stored choice and the light block for the OS differ. The lesson Quiet Console's audit taught stands: check the cross product, not a hand-picked list, because a fitness function only guards what it declares.

### Distance from the template look

ΔE_OK is the straight-line distance in OKLab; one just-noticeable difference is 0.02 ([CSS Color 4](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)). The reference is Brittany Chiang's v4 portfolio template ([bchiang7/v4](https://github.com/bchiang7/v4): 8,286 stars and 4,203 forks as of 2026-10-22): green `#64ffda` on navy `#0a192f`. Measured 2026-10-23:

| Color | Value | Template color | ΔE_OK |
|---|---|---|---|
| dark background (petrol) | `#08212a` | navy `#0a192f` | 0.033 |
| dark `primary` (apricot) | `#f9bc8b` | green `#64ffda` | 0.212 |
| light `primary` | `#a14e1b` | green `#64ffda` | 0.456 |

The petrol sits less than two just-noticeable differences from the template's navy, so the background alone does not set the site apart. The apricot accent, the condensed type and the visible grid do; those are what to keep if the palette is ever revisited.

### Terminal recordings (PR 4)

No terminal panel ships in PR 3: the readout row took its place on Home. The recordings in PR 4's case studies keep their own colors, dark in both themes like the freeze screenshots. The values are gitops' Lip Gloss ANSI 256 colors (xterm palette) on `#171717`, as the research measured them on 2026-10-22:

| Use | ANSI | Value | Contrast | Result |
|---|---|---|---|---|
| text | none | `#c4c4c4` | 10.28 | pass |
| title, accent, cursor | 86 | `#5fffd7` | 14.32 | pass |
| warnings, dirty counts | 214 | `#ffaf00` | 9.72 | pass |
| success | 82 | `#5fff00` | 13.48 | pass |
| spinner | 205 | `#ff5faf` | 6.41 | pass |
| dim metadata, key help | 241 | `#626262` | **2.94** | fails; use `oklch(0.66 0 0)` `#929292` at **5.76** |
| errors | 196 | `#ff0000` | **4.48** | fails; use `oklch(0.68 0.2 25)` `#fc5855` at **5.68** |

ANSI 86 is ΔE_OK 0.0054 from the template green, the same color to the eye, which is one more reason it stays inside recordings.

## Tokens (CSS)

`apps/web/src/styles/tokens.css` is the only file in `apps/web/src` that may hold a color value; `test/color-literals.test.ts` fails on a literal anywhere else, system color keywords excepted. This section explains the file rather than copying it.

- **Two tiers.** Tier 1 (primitives) are the `oklch()` literals, and they live only in the theme blocks. Tier 2 (semantic) uses shadcn's names, and components use only these, through Tailwind (`bg-background`, `text-muted-foreground`) or `var()`. Tier 3 (component) tokens narrow a semantic token for one component; none exist since the corner brackets and the terminal panel left. The weaker design lets a component carry its own literal: then a theme change becomes a search across every file, and the contrast test cannot see the value.
- **Tailwind's own scales are removed** (`--color-*`, `--text-*`, `--radius-*` and `--font-*` set to `initial`), so a stray utility class produces nothing instead of an untested color. `@theme inline` maps the semantic tokens to Tailwind's names.
- **Themes.** Dark is the designed default: `:root` and `:root[data-theme='dark']` share one block. A stored light choice has its own block, and the OS's light preference has a second copy under `prefers-color-scheme: light`, scoped with `:where()` so a stored dark choice still wins. The test fails if the two light copies differ.
- **More contrast.** Under `prefers-contrast: more`, `subtle-foreground` steps up to `muted-foreground` and `border` to `input`, over any stored theme.
- **Print.** Paper is white whatever the screen showed: the print block sets the surfaces to white, text to black and the accent to ink. The primary button prints as an outline with ink text, so it reads the same whether or not the browser prints backgrounds, and the theme toggle is hidden.
- **Specificity.** The more-contrast and print blocks name `:root[data-theme]` too, so they outrank every theme block, stored or not. A bare `:root` would lose to `[data-theme]`, and a stored dark theme would print near-white text.

One alternative was considered and deferred: `light-dark()` with `color-scheme: light dark` would follow the OS with no copy of the light values, and would define each token once. It reaches Baseline widely available around 2026-11 (newly available on 2024-05-13), and a browser without it would get no colors at all, while the stored choice still needs the pre-paint script. Revisit when the token file is next restructured.

Browser support, from the [web-features](https://github.com/web-platform-dx/web-features) Baseline data as of 2026-10-22: `oklch()` and `color-mix()` are Baseline widely available (since 2025-11-09); cross-document view transitions (Chrome 126, Safari 18.2) are not Baseline because Firefox lacks them, which is why they sit behind a working default; `:has()`, which the card's hover uses, is newly available, and the keyboard state does not depend on it.

## Theme before first paint

The theme must be set before the first paint, or a visitor whose stored choice differs from the OS sees one frame in the wrong theme. `src/scripts/theme.js` does it, inlined in `<head>`:

- **What it sets.** With `dark` or `light` stored, `data-theme` takes that value and `data-saved` is set. Otherwise `data-theme="system"`, and CSS treats `system` exactly like a missing attribute: both follow the OS.
- **The fail-safe is the OS.** No stored choice, storage that throws (private modes, blocked storage), a blocked script and no JavaScript at all share one path: the page follows `prefers-color-scheme`. Storage access sits in `try`/`catch`.
- **Where it runs.** In `<head>`, right after the `color-scheme` meta and before any stylesheet, so it has always run before the first frame that can paint `<body>`, however the HTML arrives. PR 3 first placed it as the first child of `<body>`, and the first Worker Preview showed the gap: when the HTML arrived in pieces, a frame painted before the script ran.
- **What that costs.** Astro writes its CSP `<meta>` at the end of `<head>`, and a policy delivered in a `<meta>` element does not apply to content that comes before it ([CSP Level 3](https://www.w3.org/TR/CSP3/)). So this one script, ours and generated at build, runs before the policy and is not governed by it. Everything after the `<meta>` is. Two checks bound the exception: `test/csp.test.ts` allows exactly one script before the policy, and requires it to be byte for byte the file `astro.config.mjs` hashes; and an e2e test places a copy with one byte changed after the policy and requires the browser to refuse it. [security.md](security.md#headers-and-content-security-policy) owns the policy, and records the alternative: sending the policy as a header generated at build, which would govern this script too.
- **Its hash is still in `script-src`.** Astro does not hash `is:inline` scripts, so `astro.config.mjs` reads the same file the layout inlines and adds its sha256 to `security.csp.scriptDirective.hashes`. One source: an edit cannot leave a stale hash behind.
- **`theme` is the only key the site stores** ([security.md](security.md#privacy-and-data-inventory)); an e2e test reads `localStorage` after the toggle has run.
- **The toggle** is a native button in the footer, and the same script handles its clicks, so it adds no script of its own. It cycles System, then the theme the OS is not showing, then the one it is, and back to System: on a dark OS, System, Light, Dark. Every press but the return to System changes the page, so a first press never looks broken. Its label comes from CSS, which shows one of three spans from `data-theme` and adds "· saved in this browser" from `data-saved`, so the visible words are the accessible name. While a choice is stored it reads "Theme: dark · saved in this browser" (or light); that note keeps a stored choice inside the consent exemption for interface preferences ([security.md](security.md#privacy-and-data-inventory)). The note is one unit, so at 320 px the label breaks before it, not inside it. Without JavaScript nothing sets `data-theme`, so the toggle stays hidden: there is never a control that does nothing. If storage refuses a choice, it holds for the page and the label does not say saved.
- **Size.** The script measured 624 B gzip on 2026-10-23, against the 0.3 KB the plan estimated for the toggle alone; it is the only JavaScript on a content page.
- **Tested** (`e2e/theme.spec.ts`): the first frame that can paint `<body>` already has the right `data-theme`, saved flag and background in eight cases, a dark or light OS with nothing, light, dark or throwing storage stored; the cycle on both OSes, where every press but the last changes the page and `theme` is the only key stored; a choice survives a reload, and refused storage is never called saved; System follows an OS change live; a stored theme of either kind prints black on white, the Email button included, with the toggle hidden; more contrast applies over a stored theme; and without JavaScript the page follows the OS and shows no toggle.

## Typography

### The faces

| Face | Cut | Bytes (2026-10-23) | Source | License |
|---|---|---|---|---|
| Instrument Sans | Google Fonts' "latin" range plus → and ↗; both axes kept, width 75–100% and weight 400–700 | 55,984 | Instrument Sans 1.000, from google/fonts at commit `0b58fb37`, byte-identical to the foundry's copy | OFL 1.1, no Reserved Font Name |
| JetBrains Mono, subset "C" | ASCII, no-break space, ©, ·, dashes, curly quotes, …, ← ↑ → ↓, ↗ and ⌘; weight limited to 400–500, the two C uses; `kern` only | 8,156 | JetBrains Mono v2.304 (2023-01-14) | OFL 1.1, no Reserved Font Name |

64,140 B together, both preloaded, against the 70 KB budget. `public/fonts/` carries each license file beside the fonts.

- **Cut from pinned sources.** `apps/web/scripts/fonts/build.sh` downloads each source into a fresh temporary directory, refuses any file whose size or sha256 differs from `fonts.lock.json` before a font parser reads it, and cuts with fontTools 4.67.0 from hash-pinned wheels in a throwaway environment. CI never runs it: `test/fonts.test.ts` checks every committed and served font against the lock, byte for byte, and checks each file's name strings and tables, with known answers.
- **Code ligatures stay out.** `calt` and `liga` would draw `=>` as an arrow, which misreads in code, and cost bytes.
- **Delivery (spike S9, passed).** Astro's Fonts API with the local provider serves both files from `/_astro/fonts/`, passes the width range through to `font-stretch`, writes both preload links, and hashes the `<style>` it emits into `style-src` ([roadmap.md](roadmap.md#spikes)). Its own fallback is one face fitted to Arial at full width, which the condensed name needs per width, so it is off.
- **Fitted fallback faces.** `src/styles/font-fallbacks.css`, written by `build.sh`, holds one fallback family per common local font: Arial (and Liberation Sans and Arimo, which share its widths), Roboto for Android, DejaVu Sans for Linux without Liberation, and for mono Menlo or DejaVu Sans Mono and Courier New or Cousine. Each has `size-adjust` and ascent, descent and line-gap overrides fitted to the web font: the 100% faces to English letter frequencies, the 75–85% faces to "Joseph Peterson", the only text set at 80%. Text breaks in the same place before and after the web font arrives; the fold check measures the hero's height both ways.
- **Link previews.** Satori draws a variable font at its default instance and ignores `font-stretch`, so `build.sh` also cuts two static Instrument Sans instances for the Open Graph card (`src/og/fonts/`). They never reach the browser.

Self-hosting is not only about bytes. Since Chrome 86 the HTTP cache is partitioned per site ([Chrome](https://developer.chrome.com/blog/http-cache-partitioning)), so a shared Google Fonts cache gives no benefit. A third-party font also needs its own connection setup ([web.dev](https://web.dev/articles/font-best-practices)), and every request to it hands the visitor's IP address to another company.

### Type scale

From the approved mockup at 390 px and 1440 px. Fluid sizes run linearly between those two widths and stop at both ends.

| Token | Size | Line height | Tracking and width | Weight | Face | Use |
|---|---|---|---|---|---|---|
| kv | 10.5 px | 1.6 | +0.1em, uppercase | 500 | mono | labels in a card's facts |
| label | 11 px | 1.4 | +0.1em, uppercase | 500 | mono | readout labels, a card's index and tag, "Contact" |
| meta | 12 px | 1.5 | 0 | 400–500 | mono | the build line, section and principle numbers, the toggle |
| sm | 14 px | 22 px | 0 | 400–600 | sans; mono in readouts | a card's link, the skip link, readout values on phones |
| ui | 15 px | 1.4 | 0; +0.01em on section titles | 500–600 | sans | buttons, nav and footer links, section titles |
| base | 16 px | 26 px | 0 | 400 | sans | body text; readout values from 48rem |
| card | 17 px | 1.5 | 0 | 400 | sans | card copy |
| principle | 22 px | 1.2 | −0.01em | 620 | sans | How I work titles |
| lead | 16.5→21 px | 1.45 | 0 | 400 | sans | the proof line, the 404's text |
| title | 21→28 px | 1.15 | −0.01em | 550 | sans | the hero's title line |
| card-title | 28→32 px | 1.1 | −0.02em, 90% width | 620 | sans | card titles |
| email | 24→32 px | 1.2 | −0.02em, 90% width | 620 | sans | the footer's address |
| display | 39→61 px | 1.05 | −0.03em, 90% width | 620 | sans | the 404's heading |
| hero | 66→156 px | 0.9; 0.86 from 48rem | −0.035em, 80% width | 620 | sans | the name on Home |

Rules:

- **Mono for values and labels, never prose.** Readouts, card facts, labels and numbers are mono; sentences are sans.
- Fluid sizes mix `rem` and `vw`, each has a `rem` floor, and each maximum is at most 2.5 times its minimum (the hero: 2.36), so 200% zoom still enlarges text (SC 1.4.4; Maxwell Barvian, ["Addressing Accessibility Concerns With Using Fluid Type"](https://www.smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type/), 2023-11-07). `test/tokens.test.ts` checks all three.
- Numbers that line up (commits, dates, sizes) use tabular numerals.

## Motifs

The feel comes from structure. Each motif is CSS or real text, and each one survives with JavaScript off.

- **The ruler.** Twelve numbered columns over a tick band (a tick every 8 px), across the top of every page; phones show the first four. `aria-hidden`, because it carries no information a reader needs.
- **The readout row.** A `<dl>`: Build (the short commit), Built (the build date, a `<time>`), JavaScript (this page's eager bytes). "Built", not "Deployed": a rollback promotes an older build, whose date this is. Values come from the build itself and from the module that measures the budgets, so a printed figure and the measured one cannot drift. The readouts wrap instead of squeezing, with 1 px rules between them wherever the rows break. On every other page the footer's build line carries the same commit and date: one telemetry strip per page.
- **Section numbers.** `01`, `02`, assigned at build in the order the sections render, so a hidden section leaves no gap. In apricot mono, `aria-hidden`; the heading's words are the accessible name.
- **The location dot.** A 7 px apricot dot beside "US · remote", `aria-hidden`; the text says the same thing (SC 1.4.1).
- **The card bar.** The 2 px apricot bar that sweeps across a card's top edge when the card leads somewhere ([Chosen direction](#chosen-direction)).
- **Principle rules.** Each How I work item hangs from a 2 px rule in the text color.
- **Timestamps.** ISO 8601 dates, with no time of day and no zone: midnight UTC carries neither, and anything else would tell a reader when or where the build ran. `test/readouts.test.ts` scans every served file for a time of day or an offset in every common form. No ticking clock: a clock is auto-updating content under SC 2.2.2, and it says nothing about the work.
- **Removed: coordinates and a fixed UTC offset.** The research wireframe put one-decimal coordinates and a UTC offset in the hero label. Both are gone. One decimal of latitude and longitude resolves to about 11 km, which is city scale; next to a title, years and an industry, that narrows the search to one employer, which is the mosaic effect the content firewall exists to prevent ([ADR 0007](adr/0007-content-firewall.md)). A fixed offset is also wrong for half the year: a US offset moves by one hour at each daylight saving change (the next one is 2026-11-01). The hero carries only the location line Joseph chose (Q5 · Q-location in [product.md](product.md)).
- **Removed with Quiet Console:** the hairline grid, corner brackets, status LEDs, scanlines and the hero's terminal panel ([Lineage](#lineage)).

## Motion

| Kind | Duration and easing | With `prefers-reduced-motion: reduce` |
|---|---|---|
| Card bar sweep | 220 ms, ease-out, `transform` only | the bar appears at once |
| Hover color, focus | instant | the same |
| Page-to-page view transition | the browser's default crossfade | none |
| Theme switch | instant | the same |

Rules:

- **Author motion inside `prefers-reduced-motion: no-preference`** (no-motion-first). State changes live outside the query, so a reduced-motion visitor still sees the card's bar; only the movement is removed. `test/tokens.test.ts` fails if a transition, an animation, smooth scrolling or a view transition appears anywhere else.
- **Animate `transform` and `opacity`.** Never animate layout properties such as width, height, margin or top.
- **Nothing moves for more than 5 s without a pause control** (SC 2.2.2). **Nothing flashes more than 3 times a second** (SC 2.3.1).
- **No motion on body copy, and never on the LCP element.** The hero name is the likely LCP element; it is never faded or delayed.
- **One moving thing on screen at a time. No bounce or elastic easing.**
- **Keyboard-driven UI opens instantly, and frequent actions animate less** (Rauno Freiberg, see [Prior art](#prior-art)). When the palette arrives in PR 4, it has no open animation.

## Effects catalog

### Shipped in PR 3

| Effect | Where | How | JS | Accessibility | Obnoxiousness risk |
|---|---|---|---|---|---|
| Card bar sweep | cards that hold a link | CSS: a 2 px `::before` scaled from 0 to 1 | 0 | `:focus-within` mirrors hover; under reduce the bar appears at once | Low |
| Outline focus | everything focusable | a 2 px apricot outline, offset 3 px | 0 | the focus indicator; never removed | Low |
| Cross-document view transitions | page to page | `@view-transition { navigation: auto; }` inside no-preference ([ADR 0003](adr/0003-astro-static-first.md)) | 0 | none under reduce; Firefox navigates normally | Low |
| Theme toggle | the footer | the pre-paint script's click handler; CSS picks the label | inside the theme script | a native button whose words are its name; hidden without JavaScript and in print | Low |

Eager JavaScript on a content page: 624 B, the theme script alone, against the 5 KB budget.

### Moved from the launch list

PR 1 planned seven launch effects for Quiet Console. Where each went:

| Effect | Now | Why |
|---|---|---|
| ⌘K / Ctrl+K command palette (1.18 KB in research) | PR 4 | It earns its place when there are pages to find; until Work and About exist it would list nothing but Home |
| Telemetry strip's serving data center | PR 4 | Reading it after load needs the check that `/cdn-cgi/trace` runs no Worker code; the readout row ships the build facts meanwhile |
| Draw-on-scroll diagram | PR 3b, on `/colophon/` | The diagram lives on the colophon |
| Terminal recordings | PR 4 | They belong to the case studies |
| One-time label decode | dropped | C's labels are short, static facts; decoding them would be motion with no information |
| Static scanlines, LEDs, corner brackets | dropped | They left with Quiet Console |

### Deferred

| Effect | Ships when | JS | Accessibility | Risk |
|---|---|---|---|---|
| Terminal mode: `help`, `ls`, `open`, `cat about`, `whoami`, `theme`, `clear`, `exit` | after launch; opened from the palette or with `` Ctrl+` `` | 1.12 KB, lazy (0 until opened) | output in `role="log"`; labelled input; never the only path; the palette entry comes first because backtick is a dead key on some keyboard layouts | low noise; the risk is cringe |
| Live "N here now" count | with Presence (PR 6), on lab pages only ([lab.md](lab.md), [ADR 0009](adr/0009-lab-worker-same-origin.md)) | a WebSocket | pause control (SC 2.2.2); disconnects when the tab is hidden; aggregate counts only, never anyone's location | medium if it ticks |
| Opt-in multiplayer cursors | with Presence, on lab pages | 0.73 KB, lazy | `aria-hidden`, `pointer-events: none`, off by default, only with `(hover: hover) and (pointer: fine)`; no names, no locations | medium; low when opt-in |

### Rejected

| Option | Why not |
|---|---|
| Arwes, the sci-fi UI framework | Its README says "The ARWES project is no longer maintained and currently outdated" and that it "does not work with React strict mode nor React Server Components"; `@arwes/react` 1.0.0-next.25020502 (2025-02-05) peers React 18 ([github.com/arwes/arwes](https://github.com/arwes/arwes), [npm registry](https://registry.npmjs.org/@arwes/react), as of 2026-10-22); 27.3 KB plus React on every page |
| cmdk for the palette | 16.3 KB for cmdk 1.1.1, plus about 68 KB of React 19 on a page that has no React: about 84 KB against 1.18 KB ([dip/cmdk](https://github.com/dip/cmdk), as of 2026-10-22). Worth it only on a page that already ships React |
| asciinema-player | 65.2 KB of JS and 3.9 KB of CSS, lazy, against a 2 KB lazy budget (3.17.0, [asciinema-player](https://github.com/asciinema/asciinema-player), as of 2026-10-22). VHS and freeze ship 0 KB. Revisit only with an ADR that amends the budget |
| A boot screen, full-screen or in a panel | the LCP waits on an animation; it hides the content the 7-second scan needs, and it would need a second storage key |
| Looping glitch or CRT flicker | flash risk (SC 2.3.1), needs a pause control (SC 2.2.2), and it competes with the text |
| Autoplay audio | SC 1.4.2 Audio Control, and sound that nobody asked for |
| WebGL hero | GPU and battery cost on every visit, an LCP risk, and it carries no information |
| Scroll-jacking | it breaks native scrolling, keyboard paging and reduced-motion settings |

Adding an effect needs a row in this catalog with its measured bytes, and the budgets below must still pass. Raising a budget to fit an effect needs an ADR. Each effect is cheap alone; the risk is the sum, which is how a site ends up reading as a gimmick.

## Budgets as CI fitness functions

A fitness function is an automated check that an architectural characteristic still holds (Building Evolutionary Architectures, ch. 2). These turn "fast and accessible" from a review opinion into a failing build. [delivery.md](delivery.md) owns the job graph; this table owns the limits.

| Budget | Hard limit | Target | Measured 2026-10-23 | Check | Job |
|---|---|---|---|---|---|
| Eager JS on a content page (gzip) | ≤ 5 KB | — | 624 B: the theme script | `test/budgets.test.ts` on every page in `dist/`, measured by the module the readouts use | `verify` |
| Lazy JS per feature (gzip) | ≤ 2 KB | — | none ships | same | `verify` |
| CSS (gzip, with preflight) | ≤ 15 KB | — | 5,751 B: the stylesheet and the Fonts API's inline `@font-face` | same | `verify` |
| Preloaded fonts | ≤ 70 KB | — | 64,140 B (55,984 + 8,156) | same | `verify` |
| Home transfer, first view | ≤ 150 KB | — | about 73 KB from its parts (HTML 3.5 KB, CSS 5.4 KB, fonts 64.1 KB, gzip -9); LHCI measures the real transfer from PR 3b | Lighthouse CI against the preview | `e2e`, from PR 3b |
| Contrast | AA for every text and non-text token against every surface, both themes | — | full cross product, no forbidden pair; tightest 4.66:1 text, 3.14:1 non-text ([Measured contrast](#measured-contrast)) | `test/tokens.test.ts`, reading `tokens.css` with culori | `verify` |
| Gamut | every `oklch()` value inside sRGB | — | all pass | same test | `verify` |
| Raw colors | no color literal outside `tokens.css`, system colors excepted | — | none | `test/color-literals.test.ts` | `verify` |
| Fonts | every served font is a locked output, with only the strings and tables it should carry | — | both faces, the OG instances and the fallback CSS match the lock | `test/fonts.test.ts`, with known answers | `verify` |
| Glyph coverage | every character on every page is drawn by a self-hosted face | — | none falls back | Chromium reports the fonts that drew each text node (DevTools Protocol, `CSS.getPlatformFontsForNode`), after `text-transform`; a known answer requires characters outside both subsets (Ł, ó, ź) to be reported with the system font that drew them | `e2e` |
| Fold | the bottom edge of Home's last rendered row of 1–3 at or above the bottom of the viewport at 390×844 and 1440×900 ([content.md](content.md#home-page)) | — | 495.5 of 844 px and 545.7 of 900 px, with the web fonts; the hero is the same height without them, within 1 px | `e2e/fold.spec.ts`, fonts loaded and blocked; once in Safari on a real phone, by Joseph, before PR 3 merges | `e2e` |
| LCP, p75 mobile | ≤ 2.5 s | 1.5 s | from PR 3b | Lighthouse CI on simulated mobile (the gate); Web Analytics field data (the evidence) | `e2e`; monthly review |
| CLS | ≤ 0.1 | 0.05 | from PR 3b | same | `e2e`; monthly review |
| INP | ≤ 200 ms | 100 ms | from PR 3b | field data only; Total Blocking Time is the lab proxy | monthly review |
| axe | 0 violations | — | 0 on every page | `@axe-core/playwright` in dark, light, more contrast and forced colors, and with a stored theme opposite the OS's | `e2e` |
| Theme before first paint | the first frame has the right theme in every stored state; the toggle cycles and labels as designed; print, more contrast and no-JavaScript hold | — | all pass | `e2e/theme.spec.ts` ([Theme before first paint](#theme-before-first-paint)) | `e2e` |
| Reduced motion | nothing would move under `reduce` | — | none | `e2e/motion.spec.ts` reads the computed motion of every element and pseudo-element, then requires [`document.getAnimations()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations) to be empty after load, a hover and every Tab; a card without a link does not react to the pointer; a known answer with no preference finds the card bar's transition | `e2e` |

Lab data gates the merge; field data says whether the gate was right. Cloudflare Web Analytics rates LCP, INP and CLS from real page loads as Good, Needs Improvement or Poor, and its debug view lists the worst elements at P75 ([Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/), as of 2026-10-22). Its docs do not say whether it gives a site-wide p75 to compare with the limits above, so PR 3b settles how that number is read ([delivery.md](delivery.md)). INP needs real interactions, so no lab tool measures it directly. Playwright's emulation covers every media query the token sheet handles: `colorScheme`, `reducedMotion`, `forcedColors`, `contrast` (1.51+) and `media: 'print'` ([Playwright](https://playwright.dev/docs/api/class-page#page-emulate-media)).

Why it matters: low-contrast text is the most common accessibility failure on the web, found on 83.9% of the top million home pages ([WebAIM Million 2026](https://webaim.org/projects/million/), as of 2026-10-22). Mission-AI's focus ring shows how it happens: a style guide said AA, and nothing measured it.

## Accessibility rules

Target: WCAG 2.2 AA.

| Rule | WCAG 2.2 SC (level) | Where it applies | How it is met | Check |
|---|---|---|---|---|
| Auto-updating content can be paused | [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) (A) | nothing at launch; later the live count and recordings | a pause control wherever a value can change by itself; recordings click-to-play | e2e asserts a pause control, from the first live value |
| No single-character shortcuts | [2.1.4 Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html) (A) | the palette and terminal mode, from PR 4 | ⌘K or Ctrl+K, and `` Ctrl+` ``; nothing on a bare key | unit test on the key handler, with the palette |
| Three flashes or fewer per second | [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) (A) | every effect | nothing loops or flashes; the card bar moves once per hover | review |
| A way past repeated blocks | [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html) (A) | every page | a skip link, hidden until focused, the first thing Tab reaches | axe; keyboard pass |
| UI parts and focus contrast 3:1 | [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) (AA) | focus outline, input borders, link underlines | outline 7.81–9.99:1 dark, 4.66–5.49:1 light; `input` 3.14–4.27:1 | the contrast test |
| Color is never the only signal | [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) (A) | links, the location dot | links keep a 3:1 underline, a card's link included; the dot sits beside its words | review; axe catches part of it |
| Text contrast 4.5:1 | [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) (AA) | all text tokens | the tables above | the contrast test and axe |
| Focus is visible | [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) (AA) | everything focusable | the 2 px outline; never `outline: none` without a replacement | e2e: every control Tab reaches shows a visible outline |
| Targets at least 24 × 24 px | [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (AA) | buttons, nav and footer links, the toggle | 44 px tall (`min-height: 2.75rem`) | axe's target-size rule |
| No sideways scrolling at 320 px | [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) (AA) | the name, the readouts, the footer's address | a 66 px name that fits 320 px, readouts that wrap, an address that breaks anywhere | e2e at 320 px, web fonts loaded and blocked: page `scrollWidth` ≤ viewport width |
| Text zooms to 200% | [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) (AA) | fluid type | max ≤ 2.5 × min, with a `rem` floor | `test/tokens.test.ts` |
| Name, role and value | [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html) (A) | the theme toggle; the palette from PR 4 | a native button whose visible words are its name and state | axe plus manual VoiceOver and NVDA passes |
| Status messages are announced | [4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) (AA) | "Copied" after the palette copies the email address (PR 4) | `role="status"` | axe and manual |
| No audio | [1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html) (A) | everywhere | the site plays no sound | — |
| Motion from interactions | [2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) (AAA, not required) | all motion | honored anyway: no-motion-first | e2e under `reduce` |

Nothing on the site is sticky or fixed, so focus cannot be hidden behind it (SC 2.4.11 needs no rule of its own).

Manual checks on every PR that changes UI (the PR template carries them): a keyboard-only pass; VoiceOver on macOS and NVDA on Windows over the theme toggle, and over the palette once it exists; reduced motion on; light mode reviewed as carefully as dark, because a recruiter on a light-mode laptop sees light first when the site follows the OS.

## One nav manifest

One list feeds every way of getting around: `apps/web/src/lib/nav.ts`. The weaker design gives the header, the footer, the palette and the sitemap their own lists; the third copy drifts the first time a page is renamed.

- **Writer.** Joseph writes the list, by pull request: each item has an id, a label, an `href`, and whether it belongs in the header, the footer or both. The build keeps only the items whose page it writes, read from `src/pages`, so a link to a page that does not exist cannot render. The rule "a section shows only when it has content" ([ADR 0005](adr/0005-url-scheme.md), [content.md](content.md)) holds by construction rather than by review.
- **Today.** Work and About (PR 4) and the Colophon (PR 3b) are listed, and none is written yet, so the header shows the wordmark alone and the footer shows only the checked external profiles.
- **Readers.** The header and the footer now; the palette (PR 4) and terminal mode later. External profiles do not come from the manifest: they come from `profile.json`, and only from a record whose readiness check is recorded ([content.md](content.md#repo-readiness-checklist)).
- **Later, with the palette.** Actions join the list (copy the email address, the theme), and the theme entry's label follows the toggle's, so the two always match.

## Home, row by row

As built in PR 3, at 1440 px; the phone layout stacks the same parts in the same order. [content.md](content.md#home-page) owns the copy.

| Row | What renders | From | Notes |
|---|---|---|---|
| Header | the ruler, then the wordmark `ihaveasegway.com`, with `.com` muted | `Ruler.astro`, `Header.astro` | the nav renders only when a manifest item's page exists: none yet |
| 1 · Hero | the name (`h1`); the title; "US · remote" with the apricot dot; the proof line; the actions: Email (primary, with the `hello@` hint from 48rem), Work ↓ (to Selected work), and each checked profile, LinkedIn ↗ today, with `rel="me"` | `profile.json`, through `Hero.astro` | from 64rem the row below the name takes the 12 columns: title and location 1–4, proof 5–9, actions 10–12. Phones put the buttons two to a row |
| 2 · This build | the readout row: Build, Built, JavaScript | the build, through `Readouts.astro` | Home's telemetry strip, so Home's footer leaves the build line out |
| 3 | not rendered | — | the career timeline and the stack line wait on Q8 and Joseph's skills list (PR 4). A row with nothing to show is left out, never filled with a placeholder |
| 01 · Selected work | one card: This site, with its JavaScript and fonts figures | `index.astro`, `WorkCard.astro` | no link until `/colophon/` exists (PR 3b); stillhere's card waits on its readiness checks |
| 02 · How I work | four principles, numbered | `index.astro`, `Principles.astro` | no links until their evidence pages exist |
| Footer | "Contact" and the address; the links that exist and the checked profiles; the theme toggle; "© 2026 Joseph Peterson", plus the build line on other pages | `Footer.astro` | the address breaks anywhere, so it fits 320 px |

The fold: rows 1 and 2 end at 495.5 px of 844 on a phone and 545.7 px of 900 on a laptop, so row 3 has room when it arrives.

The 404 page uses the same frame: the ruler and header, an "Error 404" label, a display heading, a line of text and a button home, then the footer with its build line.

**The command palette (PR 4).** A `<dialog>` with a labelled combobox and a listbox; `aria-activedescendant` follows the selected row; Esc closes it and focus returns to whatever opened it. It opens in 0 ms. Subsequence matching runs over each label and its keywords, and results stay grouped as Go to, Actions and Links. Its footer reuses gitops' key-help grammar: "↑/↓ move · enter open · esc close", with "enter" spelled out because `↵` is not in JetBrains Mono. Copying the email address confirms with "Copied" in a `role="status"` region (SC 4.1.3). Profiles appear only when their records are checked.

## Prior art

| Source | What it does | What this design takes | What it leaves |
|---|---|---|---|
| Josef Müller-Brockmann, *Grid Systems in Graphic Design* (1981) | the Swiss grid: a column system that orders the page, with type as the main image | the 12-column frame, a ruler that makes the grid visible, a poster-size name | — |
| Linear, ["How we redesigned the Linear UI (part II)"](https://linear.app/now/how-we-redesigned-the-linear-ui) (2024-03-28) | themes generated in LCH from three inputs (base color, accent color, contrast) instead of 98 variables per theme | the model: a few inputs, and variants such as the `prefers-contrast: more` mapping | Inter Display |
| Charm: [VHS](https://github.com/charmbracelet/vhs) (v0.12.1, 2026-09-24) and [freeze](https://github.com/charmbracelet/freeze) (v0.2.2, 2025-04-01), as of 2026-10-22 | scripted terminal recordings and static terminal images | PR 4's recordings, with 0 KB of JS on the page | autoplay loops |
| Rauno Freiberg, ["Invisible Details of Interaction Design"](https://rauno.me/craft/interaction-design) (2023) | interaction craft; on motion, that an interaction repeated hundreds of times a day turns animation into "cognitive burden" | instant hover and focus; motion only on rare actions; a 0 ms palette | — |
| Stripe, ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems) | perceptual color tooling with contrast feedback built into how colors are chosen | the contrast check as a CI test computed from the tokens | — |
| [Arwes](https://github.com/arwes/arwes) | the canonical sci-fi web UI framework | nothing; a mood reference at most | the framework: unmaintained, React 18 only, no strict mode |
| Brittany Chiang, [v4 portfolio](https://github.com/bchiang7/v4) | teal `#64ffda` on navy `#0a192f` with numbered mono headings | nothing: this is the look to avoid | its green, and the lesson that a dark blue background alone does not set a site apart ([Distance from the template look](#distance-from-the-template-look)) |

## Open decisions this doc depends on

The list and the recommendations live in [product.md](product.md#open-decisions). Q3, Q4, Q5, Q6, Q16, Q17 and Q25 are decided, and this doc builds on their answers.

| Question | What it changes here |
|---|---|
| Q8 · Q-career-arc | Home's row 3: the career timeline's markers |
| Q28 · Q-live-count | whether a live count ever reaches the footer outside lab pages (recommended: no) |
| Q20 · Q-photo | none in the hero (recommended); `/about/` is his call |
| Q21 · Q-segway | how far `/about/` and the 404 lean into the name; the icons are chosen, a generic scooter |

## Patterns and further reading

Each pattern also has one canonical source in [reading-list.md](reading-list.md).

- Grid systems: Josef Müller-Brockmann, *Grid Systems in Graphic Design* (Niggli, 1981).
- Three-tier design tokens (primitive, semantic, component): Nathan Curtis, ["Naming Tokens in Design Systems"](https://nathanacurtis.substack.com/p/naming-tokens-in-design-systems-9e86c7444676).
- OKLab and OKLCH, perceptual color: Björn Ottosson, ["A perceptual color space for image processing"](https://bottosson.github.io/posts/oklab/); Evil Martians, ["OKLCH in CSS: why we moved from RGB and HSL"](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl).
- Accessible color systems: Stripe, ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems).
- No-motion-first: Tatiana Mac, ["prefers-reduced-motion: Taking a no-motion-first approach to animations"](https://www.tatianamac.com/posts/prefers-reduced-motion).
- Motion durations: NN/g, ["Executing UX Animations: Duration and Motion Characteristics"](https://www.nngroup.com/articles/animation-duration/).
- Progressive enhancement (view transitions and the theme toggle sit on a page that works without them): Jeremy Keith, [*Resilient Web Design*](https://resilientwebdesign.com/).
- Fitness functions: Neal Ford, Rebecca Parsons, Patrick Kua and Pramod Sadalage, [*Building Evolutionary Architectures*, 2nd ed., ch. 2](https://www.oreilly.com/library/view/building-evolutionary-architectures/9781492097532/ch02.html).
- Fail-safe default (the OS's theme if the script fails; a row or a field left out if its value cannot be read): Jerome Saltzer and Michael Schroeder, ["The Protection of Information in Computer Systems"](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html) (1975).
- One owner per piece of data (tokens in one file, navigation in one manifest, byte figures in one module, theme choice in the visitor's browser): Andrew Hunt and David Thomas, *The Pragmatic Programmer*, 20th anniversary ed., "DRY: The Evils of Duplication".
- Mosaic effect (why the coordinates and the UTC offset are gone): US Office of Management and Budget, [Memorandum M-13-13](https://obamawhitehouse.archives.gov/sites/default/files/omb/memoranda/2013/m-13-13.pdf) (2013).
- WCAG 2.2: the W3C Understanding documents linked in [Accessibility rules](#accessibility-rules).
