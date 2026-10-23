# Design system: Quiet Console

Quiet Console is how ihaveasegway.com looks and moves: Mission-AI's console neutrals, gitops' terminal grammar, and a HUD layer built from structure (hairlines, corner brackets, mono labels, LEDs, real telemetry) instead of neon, glitch or sound. This doc owns the tokens, the palette and its measured contrast, typography, the motifs, motion, the effects catalog, the design budgets, the accessibility rules and the wireframes. Why the tokens are copied rather than imported is [ADR 0010](adr/0010-quiet-console-design-tokens.md). Home's sections and copy belong to [content.md](content.md); the CSP that admits the theme script belongs to [security.md](security.md); where each check runs belongs to [delivery.md](delivery.md).

Status: Draft for review in PR 1 · 2026-10-22

**Palette and typefaces reopened on 2026-10-22.** Joseph asked for a look that is distinctive rather than what everyone else ships: creative, but not distracting. The token values, the accent (Q17) and the typefaces in this doc are a starting point. A design exploration before PR 3 replaces them with the direction he picks ([ADR 0010](adr/0010-quiet-console-design-tokens.md)). What stands: one token file with semantic names, the contrast test, the budgets and the accessibility rules. The motifs, effects and wireframes are reviewed with the direction. PR 2 ships placeholder values and system fonts.

Units: 1 KB = 1,000 bytes. JS and CSS sizes are minified and gzip -9 unless stated. Every measurement here was taken on 2026-10-22, from the research prototypes, the font files and the token values; the CI checks below replace them with numbers from the real build.

## Chosen direction

Chosen on 2026-10-23 (Q17 in [product.md](product.md#decided)). The exploration drew three directions on Home's wireframe, at 1440 px and 390 px, in both themes: A "Drawing Set", B "Field Notes" and C "Instrument". Joseph picked C, and then Petrol + Apricot from four color studies of it; Graphite + Cobalt, Ink + Chartreuse, Paper + Swiss red, and C's first palette of graphite and orange lost. Cards keep the hover he preferred: a 2px accent bar that sweeps across the card's top edge, rather than corner crop marks.

What C is:

- **A 12-column frame with a ruler.** A numbered tick band across the top marks the columns the layout sits on, four of them on a phone. It is decoration, hidden from assistive technology.
- **A poster-size name.** 156 px at 1440 px and 66 px on a 390 px phone (a ratio of 2.36, inside the 2.5 the type scale allows). Under it, one row holds the title and location, a line of proof, and the actions.
- **A readout row.** Facts about the build in mono, read from the build itself: the commit, the build date, the JavaScript shipped. It is the seed of the status line.
- **One accent.** Apricot fills the primary button, marks focus and the location dot, numbers sections, and colors a link on hover. Otherwise links read as text with an underline at 3:1, so the underline, not the color, marks them (SC 1.4.1). `--signal` points at the accent.
- **Type.** Instrument Sans, whose width axis runs from 75% to 100% and gives the condensed name, and JetBrains Mono for labels and readouts; both OFL 1.1. They arrive in PR 3 through spike S9. Until then the site uses system stacks.

PR 2 ships these values in `tokens.css`:

| Token | Dark | Light |
|---|---|---|
| `--background` | `oklch(0.233 0.035 225)` `#08212a` | `oklch(0.981 0.007 220)` `#f4fafc` |
| `--surface-1` | `oklch(0.272 0.041 225)` `#0c2b36` | `oklch(0.951 0.011 211)` `#e7f1f3` |
| `--surface-2` | `oklch(0.31 0.044 225)` `#143541` | `oklch(0.925 0.014 212)` `#dce9ec` |
| `--foreground` | `oklch(0.961 0.01 205)` `#ebf4f5` | `oklch(0.219 0.03 231)` `#0a1d26` |
| `--muted-foreground` | `oklch(0.8 0.025 216)` `#adc2c8` | `oklch(0.471 0.03 225)` `#495f68` |
| `--subtle-foreground` | `oklch(0.72 0.03 218)` `#90aab1` | `oklch(0.505 0.03 222)` `#526971` |
| `--border` | `oklch(0.431 0.04 223)` `#375560` | `oklch(0.861 0.015 213)` `#c7d4d7` |
| `--input` | `oklch(0.6 0.035 220)` `#69868f` | `oklch(0.6 0.03 220)` `#6d858d` |
| `--primary` | `oklch(0.84 0.095 60)` `#f9bc8b` | `oklch(0.52 0.126 48)` `#a14e1b` |
| `--primary-strong` | `oklch(0.88 0.068 62)` `#f9ceaa` | `oklch(0.46 0.115 46)` `#8a3f15` |
| `--primary-foreground` | `oklch(0.2 0.029 60)` `#201308` | `oklch(0.991 0.005 211)` `#f8fdfe` |
| `--grid-line` | `--foreground` at 6% | `--foreground` at 6% |
| `--signal`, `--ring` | `var(--primary)` | `var(--primary)` |
| `--ok`, `--destructive` | `var(--foreground)`, until a page shows a status | the same |

Measured by `test/tokens.test.ts` on 2026-10-23: every text token reaches 4.5:1 and every non-text token 3:1 on all three surfaces in both themes, the full cross product with no forbidden pair. The tightest pairs are in light: `primary` on `surface-2` at 4.66:1, `subtle-foreground` on `surface-2` at 4.68:1, and `input` on `surface-2` at 3.14:1. `primary-foreground` on `primary` measures 10.91:1 in dark and 5.65:1 in light.

The token file keeps all sixteen semantic names. Tailwind's own palette, text sizes and radii are removed, so a stray utility class produces nothing instead of an untested color. Themes switch on `prefers-color-scheme` alone: `[data-theme]` and the toggle come with the theme script in PR 3, and the motion and HUD motif tokens with the components that use them. Beyond the cross product, the contrast test fails when a color token has no declared role, or when the light theme does not redeclare one.

Forced colors: a Windows contrast theme replaces the button's apricot fill with the user's background but keeps the label's own color, which axe measured at 1.02:1. So under `forced-colors: active` the primary button takes system colors (`ButtonFace`, `ButtonText`). System color keywords are the one kind of color allowed outside `tokens.css`.

The rest of this doc still describes Quiet Console, the starting point. Where its token table, contrast table, typography or motifs conflict with this section, this section wins; PR 3 rewrites them around C, together with [ADR 0010](adr/0010-quiet-console-design-tokens.md).

## Why

- Recruiters give the page seconds and engineers give it a minute ([content.md](content.md) has the evidence). A slow, hard-to-read or templated page contradicts what the site says about its author, so speed and accessibility are requirements here, not polish.
- The ask was a "cyber" feel. The need is evidence. The HUD layer earns its place only where it shows something real: gitops' terminal output, the commit that built the page, the data center that served it (principle 6 in [product.md](product.md)).
- If nothing is done, the site gets shadcn's stock look, which reads as a template, or a sci-fi skin that delays the first word.

## Options considered

| Option | Bytes and latency | Accessibility | Recognition | Upkeep | Verdict |
|---|---|---|---|---|---|
| **A. Quiet Console**: Mission-AI neutrals, gitops grammar, structural HUD | about 2.2 KB of eager JS for every launch effect; fonts 64.1 KB | all 25 declared token pairs pass AA in both themes | built from his own tools | one token file; vanilla modules behind flags | **Recommended** |
| B. Sci-fi skin: Arwes, neon, looping glitch, boot screen | Arwes is 27.3 KB plus React; LCP waits on the boot animation | looping motion needs controls under SC 2.2.2 and risks SC 2.3.1 | reads as a game UI | Arwes says it is no longer maintained | Rejected |
| C. A known look: Vercel's Geist, or teal on navy with numbered headings (Brittany Chiang's v4 template) | smallest fonts (the Geist pair is 52.5 KB) | fine | reads as someone else's | low | Rejected |
| D. Plain text: system fonts, no HUD | best: close to 0 KB of JS, no font bytes | best | forgettable; ignores the brief | lowest | Runner-up |

D is what principle 1 alone would pick, and it stays the fallback: every effect in A can be removed without breaking a page. A spends about 2.2 KB of JavaScript and some design time to answer the "cyber" brief with real data instead of decoration. Door: two-way for everything except the accent hue ([ADR 0010](adr/0010-quiet-console-design-tokens.md)).

Evidence that A was wrong: field p75 mobile LCP above 2.5 s, INP above 200 ms or CLS above 0.1; axe, VoiceOver or NVDA failures; three of five recruiter or peer reviewers call it "gimmicky" or "hard to read", or name a template.

## Data the design system touches

[architecture.md](architecture.md) owns the site-wide table. This is the slice the design system reads or writes.

| Datum | System of record | Writer | Readers | How it crosses | Consistency needed |
|---|---|---|---|---|---|
| Token values | `apps/web/src/styles/tokens.css` | Joseph, by PR | every component; the contrast test | build (CSS) | exact per deploy |
| Theme choice | the visitor's browser (`localStorage` key `theme`) | the visitor | the pre-paint script; the toggle module, which labels the toggle and the palette entry | never leaves the browser | per browser |
| Nav manifest | generated at build from routes and content collections | the build | header, palette, terminal, sitemap check | build artifact | exact per deploy |
| Build SHA, build time, page weight | git and the CI run | CI | telemetry strip | written into the HTML at build | exact for that deploy |
| Serving data center ("colo") | none: Cloudflare's edge derives it per request | Cloudflare | telemetry strip, for that visitor only | the `colo` line of Cloudflare's `/cdn-cgi/trace`, read in the browser after load | per request; never stored or sent anywhere |

Mission-AI's packages are not an upstream: no sync, no second owner. The weaker design imports them, and two repositories then write the same values.

## Design DNA

| | Mission-AI console UI | gitops TUI | Quiet Console |
|---|---|---|---|
| Neutrals | shadcn zinc (hue about 286), stored as bare oklch triplets | `#171717` window, `#c4c4c4` text | Mission-AI's zinc, stored as full `oklch()` values |
| Accent | none: dark `primary` is white | ANSI 86 `#5fffd7` (title, accent, cursor); README release badge `#00c2a8` | one accent derived from the badge; ANSI 86 only inside terminal panels |
| Second color | status tones (emerald, blue, amber, red) plus seven domain hue washes | ANSI 214 `#ffaf00` for warnings and dirty counts | one amber `signal` for attention and the "now" marker |
| Type | Inter + JetBrains Mono; 14px UI text; 11px uppercase labels at 0.18–0.2em | JetBrains Mono, 13px in recordings | Inter Variable + a JetBrains Mono HUD subset; 16px prose; 11px mono labels at 0.16em |
| Radius | 10px; cards `rounded-xl`, hero `rounded-2xl` | 8px window | 4px panels, 2px chips, round only for LEDs |
| Density | console: 64px header, gaps 4/8/12/16/24/32 | one fact per line | reading site: 16/26 prose, 56px header, 96px section rhythm (64px on mobile) |
| Patterns | module map with Live / Coming soon badges, metric tiles, dashed roadmap cards, 8-character IDs with copy, a timeline with a "now" line | `gitops › status` header, dim facts joined by ` · `, `▸` cursor, `✓`/`✗`, `↑`/`↓`, key-help footer | project cards, a map of how this site runs, the career timeline, a SHA chip, terminal panels, a palette footer in key-help grammar |
| Voice | Live / Coming soon / Roadmap | counts, not adjectives | LIVE / PRE-RELEASE / PLANNED; numbers read from GitHub at build time |

What does not carry over:

- **The seven domain hue washes.** They fit a console with many domains. On a portfolio they are noise, and they would compete with the one accent.
- **Triplet tokens** (`--primary: 0.205 0.006 285.885`, wrapped as `oklch(var(--primary))`). That was a Tailwind v3-era workaround for opacity modifiers. Tailwind v4 compiles `bg-background/80` to `color-mix(in oklab, var(--background) 80%, transparent)` (compiled on 4.3.3, as of 2026-10-22; [Tailwind v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4)), so full values work and read better.
- **The focus ring.** `ring-[3px] ring-ring/50` renders at 1.21:1 in light and 1.47:1 in dark, against the 3:1 that SC 1.4.11 asks for. It is replaced by a 2px solid outline in the accent: 11.20:1 dark, 5.03:1 light.
- The same audit found dark destructive text at 4.16:1 and white 12px labels on amber-500 (2.15:1) and emerald-600 (3.67:1). Mission-AI's style guide claimed AA, and nothing tested it. That is why the contrast table below is a CI test and not a comment.

## Palette

Dark-first, light fully supported, following the OS by default ([Theme before first paint](#theme-before-first-paint)). One accent, one signal; everything else is neutral.

### Tokens

| Token | Role | Dark | Light |
|---|---|---|---|
| `--background` | page | `oklch(0.145 0.005 285.8)` `#0a0a0c` | `oklch(0.985 0.002 286)` `#fafafb` |
| `--surface-1` | cards (`card`) | `oklch(0.178 0.005 285.8)` `#111113` | `oklch(1 0 0)` `#ffffff` |
| `--surface-2` | popovers, palette (`popover`, `muted`, `secondary`, shadcn `accent`) | `oklch(0.21 0.006 285.9)` `#18181b` | `oklch(0.967 0.003 286)` `#f4f4f6` |
| `--foreground` | body text | `oklch(0.985 0 0)` `#fafafa` | `oklch(0.21 0.006 285.9)` `#18181b` |
| `--muted-foreground` | secondary text | `oklch(0.715 0.007 286.3)` `#a2a2a7` | `oklch(0.442 0.017 285.8)` `#52525c` |
| `--subtle-foreground` | 11px mono labels, meta | `oklch(0.62 0.012 286)` `#85858d` | `oklch(0.50 0.016 285.9)` `#62626c` |
| `--border` | decorative separators only | `oklch(0.274 0.006 286)` `#27272a` | `oklch(0.92 0.004 286.3)` `#e4e4e7` |
| `--input` | functional borders (3:1) | `oklch(0.52 0.01 286)` `#68686f` | `oklch(0.62 0.01 286)` `#85858c` |
| `--primary` | the accent: links, focus, active state | `oklch(0.80 0.13 178)` `#43d9be` | `oklch(0.52 0.09 182)` `#0e7a6d` |
| `--primary-strong` | accent on hover | `oklch(0.86 0.14 176)` `#4fefcd` | `oklch(0.45 0.075 184)` `#10635a` |
| `--primary-foreground` | text on accent buttons | `oklch(0.145 0.005 285.8)` `#0a0a0c` | `oklch(1 0 0)` `#ffffff` |
| `--signal` | amber: attention, the "now" marker | `oklch(0.82 0.15 75)` `#fcb442` | `oklch(0.56 0.13 55)` `#ad5c15` |
| `--ok` | LED, success | `oklch(0.80 0.17 152)` `#56dc85` | `oklch(0.527 0.137 150)` `#15803d` |
| `--destructive` | errors | `oklch(0.70 0.19 23)` `#ff6364` | `oklch(0.55 0.22 27)` `#d40c1a` |
| `--grid-line` | hero grid | `oklch(1 0 0 / 0.05)` | `oklch(0.21 0.006 285.9 / 0.06)` |
| `--ring` | focus outline | `var(--primary)` | `var(--primary)` |

Eight of the sixteen neutral values are steps of Tailwind's public zinc scale (MIT): same lightness, chroma within 0.002 ([Tailwind 4.3.3 theme](https://cdn.jsdelivr.net/npm/tailwindcss@4.3.3/theme.css), as of 2026-10-22). The dark background is zinc-950 lightened by 0.004. The rest, the accent, the signal and the label tone are new. In shadcn's vocabulary `accent` is a hover surface, not the brand color; the brand color is `--primary`. The names stay shadcn's, so lab islands that use shadcn components ([ADR 0003](adr/0003-astro-static-first.md)) need no mapping.

### Measured contrast, both themes

Method: OKLCH to OKLab to linear sRGB ([Ottosson's matrices](https://bottosson.github.io/posts/oklab/)), then WCAG 2.2 [relative luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance). Every site token is inside the sRGB gamut, so no browser clips it. The PR 2 contrast test reproduces this table from the token file. Need: 4.5:1 for text, 3:1 for non-text.

| # | Pair | Need | Dark | Light |
|---|---|---|---|---|
| 1 | foreground on background | 4.5 | 18.96 | 16.98 |
| 2 | foreground on surface-1 | 4.5 | 18.08 | 17.73 |
| 3 | foreground on surface-2 | 4.5 | 16.98 | 16.11 |
| 4 | muted-foreground on background | 4.5 | 7.83 | 7.40 |
| 5 | muted-foreground on surface-1 | 4.5 | 7.46 | 7.73 |
| 6 | muted-foreground on surface-2 | 4.5 | 7.01 | 7.02 |
| 7 | subtle-foreground (11px labels) on background | 4.5 | 5.42 | 5.77 |
| 8 | subtle-foreground on surface-1 | 4.5 | 5.17 | 6.02 |
| 9 | subtle-foreground on surface-2 | 4.5 | 4.86 | 5.47 |
| 10 | primary on background (also the focus outline) | 4.5 | 11.20 | 5.03 |
| 11 | primary on surface-1 | 4.5 | 10.68 | 5.25 |
| 12 | primary on surface-2 | 4.5 | 10.03 | 4.77 |
| 13 | primary-strong on background | 4.5 | 13.69 | 6.84 |
| 14 | primary-foreground on primary (buttons) | 4.5 | 11.20 | 5.25 |
| 15 | primary-foreground on primary-strong | 4.5 | 13.69 | 7.15 |
| 16 | signal on background | 4.5 | 11.12 | 4.66 |
| 17 | signal on surface-1 | 4.5 | 10.60 | 4.86 |
| 18 | ok (LED) on background | 3.0 | 11.30 | 4.81 |
| 19 | ok on surface-1 | 3.0 | 10.78 | 5.02 |
| 20 | destructive on background | 4.5 | 6.80 | 5.20 |
| 21 | destructive on surface-1 | 4.5 | 6.48 | 5.43 |
| 22 | input border on background | 3.0 | 3.59 | 3.49 |
| 23 | input border on surface-1 | 3.0 | 3.42 | 3.65 |
| 24 | input border on surface-2 | 3.0 | 3.21 | 3.31 |
| 25 | focus outline (primary) on surface-2 | 3.0 | 10.03 | 4.77 |

All 25 declared pairs pass in both themes. Worst text pairs: 4.86:1 in dark (row 9), 4.66:1 in light (row 16).

**One undeclared pair fails.** The full cross product (8 text tokens and 3 non-text tokens against 3 surfaces, 33 combinations per theme) passes 33/33 in dark and 32/33 in light: `signal` text on `surface-2` measures 4.42:1. The light value stays as decided, with a rule: signal text never sits on `surface-2` in light (the palette and popovers use `foreground` and `muted-foreground`), and the test lists the pair as forbidden. If a design ever needs it there, the fix is one line: `oklch(0.55 0.13 55)` (`#aa5910`) measures 4.61:1 on `surface-2` and 4.86:1 on the background. The lesson for the test: check the cross product, not a hand-picked list, because a fitness function only guards what it declares.

### Terminal panel

Always dark, in both themes, like the freeze screenshots. The colors are gitops' Lip Gloss ANSI 256 values (xterm palette) on `#171717`:

| Use in gitops | ANSI | Value | Contrast | Result |
|---|---|---|---|---|
| text | none | `#c4c4c4` | 10.28 | pass |
| title, accent, cursor | 86 | `#5fffd7` | 14.32 | pass |
| warnings, dirty counts | 214 | `#ffaf00` | 9.72 | pass |
| success | 82 | `#5fff00` | 13.48 | pass |
| spinner | 205 | `#ff5faf` | 6.41 | pass |
| dim metadata, key help | 241 | `#626262` | **2.94** | fails; use `oklch(0.66 0 0)` `#929292` at **5.76** |
| errors | 196 | `#ff0000` | **4.48** | fails; use `oklch(0.68 0.2 25)` `#fc5855` at **5.68** |

The research used `#606060` for ANSI 241 (2.85:1); xterm's value is `#626262`. Both fail, and the fix is the same.

### Overlays

Scanlines sit over text and the hero grid sits under it, so both have a contrast budget. The first rows show the curve on the page's weakest text; the panel row is where scanlines actually ship.

| Overlay | Worst text it touches | Contrast |
|---|---|---|
| none | `subtle-foreground` label on the dark background | 5.42 |
| scanline, black 3% / 4% / 5% | same | 5.15 / 5.06 / 4.97 |
| scanline, black 4%, on the terminal panel (where it ships) | `#fc5855` error text (`#929292` dim text: 5.39) | 5.32 |
| grid line, white 5% (dark) | `subtle-foreground` label | 4.95 |
| grid line, ink 6% (light) | `subtle-foreground` label | 5.11 |

Rules: scanlines at 4% or less, static, dark theme only. The grid sits behind the hero only, never behind prose.

### Distance from the template look

ΔE_OK is the straight-line distance in OKLab; one just-noticeable difference is 0.02 ([CSS Color 4](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)). The reference is `#64ffda`, the green of Brittany Chiang's v4 portfolio template ([bchiang7/v4](https://github.com/bchiang7/v4): 8,286 stars and 4,203 forks as of 2026-10-22).

| Color | Value | ΔE_OK to `#64ffda` |
|---|---|---|
| gitops ANSI 86 | `#5fffd7` | 0.0054: the same color to the eye |
| dark `primary-strong` (hover) | `#4fefcd` | 0.048 |
| dark `primary` (the accent) | `#43d9be` | 0.109 |
| light `primary` | `#0e7a6d` | 0.391 |

That is why ANSI 86 stays inside terminal panels. The other differences: zinc instead of navy (`#0a192f`), the amber second color, and bracketed labels that carry a live fact instead of plain numbered headings. `primary-strong` is the closest site token; it is used for hover only, never as a large fill.

## Tokens (CSS)

Three tiers. Tier 1 (primitives) are the `oklch()` literals, and they live only in the theme blocks. Tier 2 (semantic) uses shadcn's names, and components use only these. Tier 3 (component) narrows a semantic token for one component: `--bc` for bracket color, `--term-*` for the terminal panel. The weaker design lets a component carry its own color literal; then a theme change becomes a search across every file, and the contrast test cannot see the value.

Sketch: confirm against current Tailwind and browser docs when building (PR 2). It is adapted from the research prototype, which compiled on Tailwind 4.3.3 to 4,388 B of CSS including preflight. Changes from the prototype: `.surface` uses longhands (the `background` shorthand erased the brackets), the lock-on state moved outside the motion query (so reduced motion gets the state without the motion), the focus rule no longer changes `border-radius`, print keeps the hero and prints the accent and terminal colors in black (dark-theme links would print at 1.76:1 on white), and the two ANSI literals are hex (their rounded oklch forms fell outside sRGB).

```css
/* apps/web/src/styles/tokens.css: Quiet Console tokens.
   Sketch: confirm against current docs when building.
   global.css: @import "tailwindcss"; @import "./tokens.css"; */

/* shadcn's dark: classes (lab islands only) follow the toggle, not the OS */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  --radius: 0.25rem; --hairline: 1px; --grid-size: 32px; --bracket-size: 10px;
  --measure: 68ch;   --header-h: 3.5rem;
  --dur-instant: 0ms;   /* palette, terminal: keyboard UI opens at once */
  --dur-micro: 120ms;   /* hover color, focus */
  --dur-small: 180ms;   /* popover, bracket lock-on */
  --dur-medium: 240ms;  /* theme crossfade */
  --dur-decode: 600ms;  /* hard cap for the label decode */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
@media (max-width: 40rem) { :root { --header-h: 3.25rem; } }   /* 52px header on phones */

/* Dark is the default: if the pre-paint script never runs, the page renders dark, not broken. */
:root, :root[data-theme="dark"] {
  color-scheme: dark;
  --background:         oklch(0.145 0.005 285.8);   /* #0a0a0c */
  --surface-1:          oklch(0.178 0.005 285.8);   /* #111113 cards */
  --surface-2:          oklch(0.21 0.006 285.9);    /* #18181b popovers, palette */
  --foreground:         oklch(0.985 0 0);           /* #fafafa 18.96:1 */
  --muted-foreground:   oklch(0.715 0.007 286.3);   /* #a2a2a7  7.83:1 */
  --subtle-foreground:  oklch(0.62 0.012 286);      /* #85858d  5.42:1; 4.86:1 on surface-2 */
  --border:             oklch(0.274 0.006 286);     /* #27272a  decorative only */
  --input:              oklch(0.52 0.01 286);       /* #68686f  3.21:1 on surface-2 */
  --grid-line:          oklch(1 0 0 / 0.05);
  --primary:            oklch(0.80 0.13 178);       /* #43d9be 11.20:1, from gitops' #00c2a8 */
  --primary-strong:     oklch(0.86 0.14 176);       /* #4fefcd hover only */
  --primary-foreground: oklch(0.145 0.005 285.8);   /* 11.20:1 on primary */
  --signal:             oklch(0.82 0.15 75);        /* #fcb442 11.12:1 */
  --ok:                 oklch(0.80 0.17 152);       /* #56dc85 */
  --destructive:        oklch(0.70 0.19 23);        /* #ff6364  6.80:1 */
  --ring:               var(--primary);
  --scanline-alpha:     0.04;
}

:root[data-theme="light"] {
  color-scheme: light;
  --background:         oklch(0.985 0.002 286);     /* #fafafb */
  --surface-1:          oklch(1 0 0);               /* #ffffff */
  --surface-2:          oklch(0.967 0.003 286);     /* #f4f4f6 */
  --foreground:         oklch(0.21 0.006 285.9);    /* #18181b 16.98:1 */
  --muted-foreground:   oklch(0.442 0.017 285.8);   /* #52525c  7.40:1 */
  --subtle-foreground:  oklch(0.50 0.016 285.9);    /* #62626c  5.77:1; 5.47:1 on surface-2 */
  --border:             oklch(0.92 0.004 286.3);    /* #e4e4e7 */
  --input:              oklch(0.62 0.01 286);       /* #85858c  3.31:1 on surface-2 */
  --grid-line:          oklch(0.21 0.006 285.9 / 0.06);
  --primary:            oklch(0.52 0.09 182);       /* #0e7a6d  5.03:1; 4.77:1 on surface-2 */
  --primary-strong:     oklch(0.45 0.075 184);      /* #10635a */
  --primary-foreground: oklch(1 0 0);               /* 5.25:1 on primary */
  --signal:             oklch(0.56 0.13 55);        /* #ad5c15  4.66:1; never on surface-2 (4.42:1) */
  --ok:                 oklch(0.527 0.137 150);     /* #15803d */
  --destructive:        oklch(0.55 0.22 27);        /* #d40c1a  5.20:1 */
  --ring:               var(--primary);
  --scanline-alpha:     0;                          /* scanlines read as dirt on paper */
}

@theme inline {                                     /* values are var() references, so: inline */
  --color-background: var(--background);   --color-foreground: var(--foreground);
  --color-card: var(--surface-1);          --color-card-foreground: var(--foreground);
  --color-popover: var(--surface-2);       --color-popover-foreground: var(--foreground);
  --color-primary: var(--primary);         --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--surface-2);     --color-secondary-foreground: var(--foreground);
  --color-muted: var(--surface-2);         --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--surface-2);        --color-accent-foreground: var(--foreground);  /* shadcn: a hover surface */
  --color-subtle-foreground: var(--subtle-foreground);
  --color-destructive: var(--destructive); --color-border: var(--border);
  --color-input: var(--input);             --color-ring: var(--ring);
  --color-signal: var(--signal);           --color-ok: var(--ok);   --color-grid: var(--grid-line);
}

@theme {                                            /* static values; type scale in "Typography" */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono HUD", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --radius-sm: 2px; --radius-md: 4px; --radius-lg: 6px;
  --text-label: 0.6875rem; --text-label--line-height: 1rem; --text-label--letter-spacing: 0.16em; --text-label--font-weight: 500;
  --text-meta: 0.75rem;    --text-meta--line-height: 1rem;  --text-meta--letter-spacing: 0.02em;
  --text-sm: 0.875rem;     --text-sm--line-height: 1.375rem;
  --text-base: 1rem;       --text-base--line-height: 1.625rem;
  --text-lead: 1.125rem;   --text-lead--line-height: 1.75rem;
  --text-h3: 1.25rem;      --text-h3--line-height: 1.75rem; --text-h3--letter-spacing: -0.01em; --text-h3--font-weight: 600;
  --text-h2: clamp(1.375rem, 1.2rem + 0.8vw, 1.5625rem);     --text-h2--line-height: 1.2;  --text-h2--letter-spacing: -0.015em; --text-h2--font-weight: 600;
  --text-h1: clamp(1.953rem, 1.6rem + 1.6vw, 2.441rem);      --text-h1--line-height: 1.15; --text-h1--letter-spacing: -0.02em;  --text-h1--font-weight: 600;
  --text-display: clamp(2.441rem, 1.8rem + 3.2vw, 3.815rem); --text-display--line-height: 1.05; --text-display--letter-spacing: -0.03em; --text-display--font-weight: 650;
}

@layer base {
  html { scroll-padding-top: calc(var(--header-h) + 1rem); }      /* SC 2.4.11: the sticky header never covers focus */
  body { background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }   /* 11.20:1 dark, 5.03:1 light */
  ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }
  code, kbd, samp, pre { font-family: var(--font-mono); font-variant-ligatures: none; }
  time, data, .tabular { font-variant-numeric: tabular-nums; }
}

@layer components {
  .glass {                                          /* the sticky header */
    background: color-mix(in oklab, var(--background) 80%, transparent);
    backdrop-filter: blur(8px);
  }
  .hud-grid {                                       /* hero only: hairline grid, faded out by a mask */
    background-image:
      linear-gradient(to right, var(--grid-line) var(--hairline), transparent var(--hairline)),
      linear-gradient(to bottom, var(--grid-line) var(--hairline), transparent var(--hairline));
    background-size: var(--grid-size) var(--grid-size);
    mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 45%, transparent 100%);
  }
  .hud-brackets {                                   /* four corners from eight 1px gradients; no extra DOM */
    --bc: var(--subtle-foreground); --b: var(--bracket-size); --o: -4px;   /* at rest: 4px inside */
    --g: linear-gradient(var(--bc) 0 0);
    background-image: var(--g), var(--g), var(--g), var(--g), var(--g), var(--g), var(--g), var(--g);
    background-repeat: no-repeat;
    background-size: var(--b) 1px, 1px var(--b), var(--b) 1px, 1px var(--b),
                     var(--b) 1px, 1px var(--b), var(--b) 1px, 1px var(--b);
    background-position:
      calc(0% - var(--o)) calc(0% - var(--o)),     calc(0% - var(--o)) calc(0% - var(--o)),
      calc(100% + var(--o)) calc(0% - var(--o)),   calc(100% + var(--o)) calc(0% - var(--o)),
      calc(0% - var(--o)) calc(100% + var(--o)),   calc(0% - var(--o)) calc(100% + var(--o)),
      calc(100% + var(--o)) calc(100% + var(--o)), calc(100% + var(--o)) calc(100% + var(--o));
  }
  .hud-brackets:is(:hover, :focus-within) { --o: 0px; --bc: var(--primary); }  /* lock-on: state here, motion below */
  .surface {                                        /* longhands only: a background shorthand would erase the brackets */
    background-color: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius);
  }
  .surface[data-status="planned"] { background-color: transparent; border-style: dashed; }
  .hud-label {                                      /* [01] WORK ──── <live fact>; the number is aria-hidden */
    display: flex; align-items: center; gap: 0.75rem;
    font-family: var(--font-mono); font-size: var(--text-label); line-height: var(--text-label--line-height);
    font-weight: var(--text-label--font-weight); letter-spacing: var(--text-label--letter-spacing);
    text-transform: uppercase; color: var(--subtle-foreground);
  }
  .hud-label::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .hud-label > .n { color: var(--primary); }
  .led {                                            /* always beside text that says the same thing (SC 1.4.1) */
    display: inline-block; flex: none; inline-size: 0.5rem; block-size: 0.5rem; border-radius: 50%;
    background: var(--ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ok) 18%, transparent);
  }
  .led[data-state="warn"] { background: var(--signal); box-shadow: 0 0 0 3px color-mix(in oklab, var(--signal) 18%, transparent); }
  .led[data-state="off"]  { background: var(--subtle-foreground); box-shadow: none; }
  .term {                                           /* terminal panel: dark in both themes */
    color-scheme: dark;
    --term-bg: #171717;   --term-fg: #c4c4c4;       /* 10.28:1 */
    --term-accent: #5fffd7;                         /* ANSI 86: inside terminal panels only */
    --term-warn: #ffaf00; --term-ok: #5fff00;       /* ANSI 214, ANSI 82 */
    --term-dim: oklch(0.66 0 0);                    /* #929292 5.76:1 (ANSI 241 is 2.94:1) */
    --term-err: oklch(0.68 0.2 25);                 /* #fc5855 5.68:1 (ANSI 196 is 4.48:1) */
    background: var(--term-bg); color: var(--term-fg);
    font: 400 0.8125rem/1.5 var(--font-mono);       /* 13px */
    border-radius: var(--radius); overflow-x: auto; /* scrolls inside itself; the page never scrolls sideways */
  }
  .fx-scanlines { position: relative; isolation: isolate; }
  .fx-scanlines::after {                            /* static; 4% black in dark, 0 in light */
    content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(to bottom, transparent 0 2px, oklch(0 0 0 / var(--scanline-alpha)) 2px 3px);
  }
  .is-scrambling { position: relative; color: transparent; }                         /* real text stays in the DOM */
  .scramble-layer { position: absolute; inset: 0; color: var(--subtle-foreground); } /* aria-hidden overlay */
}

@property --bc { syntax: "<color>"; inherits: true; initial-value: transparent; }

@media (prefers-reduced-motion: no-preference) {   /* no-motion-first: motion exists only in here */
  html { scroll-behavior: smooth; }
  .hud-brackets { transition: background-position var(--dur-small) var(--ease-out), --bc var(--dur-small) linear; }
  .led[data-pulse] { animation: led-pulse 1.2s var(--ease-in-out) 3; }   /* 3.6 s, inside SC 2.2.2's 5 s */
  @supports (animation-timeline: view()) {          /* Chrome and Edge 115+, Safari 26+ */
    [data-draw] path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw linear both;
                       animation-timeline: view(); animation-range: entry 10% cover 40%; }  /* paths use pathLength="1" */
  }
  [data-draw].will-draw path { stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset 900ms var(--ease-out); }
  [data-draw].will-draw.is-drawn path { stroke-dashoffset: 0; }   /* Firefox: the 0.31 KB IntersectionObserver fallback */
  @view-transition { navigation: auto; }            /* cross-document; Firefox navigates normally */
}
@keyframes led-pulse { 50% { box-shadow: 0 0 0 5px color-mix(in oklab, var(--ok) 0%, transparent); } }
@keyframes draw { to { stroke-dashoffset: 0; } }

@media (prefers-contrast: more) {                  /* :root[data-theme] is (0,2,0) and later, so it beats both theme blocks */
  :root, :root[data-theme] {
    --grid-line: transparent; --scanline-alpha: 0;
    --subtle-foreground: var(--muted-foreground); --border: var(--input);
  }
}
@media (forced-colors: active) {
  .hud-grid, .hud-brackets, .fx-scanlines::after { background: none; mask-image: none; }
  .scramble-layer { display: none; }
  .led { forced-color-adjust: none; border: 1px solid CanvasText; }
  :focus-visible { outline-color: Highlight; }
}
@media (prefers-reduced-transparency: reduce) {    /* Chromium only today; harmless elsewhere */
  .glass { backdrop-filter: none; background: var(--surface-2); }
}
@media print {
  :root, :root[data-theme] { --background: #fff; --foreground: #000; --muted-foreground: #333; --subtle-foreground: #444; --primary: #000; }
  .hud-grid { background: none; mask-image: none; }   /* keep the hero, drop its grid */
  .fx-scanlines::after, .telemetry, .cursor-layer, .glass { display: none; }
  .term { --term-bg: #fff; --term-fg: #000; --term-dim: #444; --term-accent: #000; --term-warn: #000; --term-ok: #000; --term-err: #000; border: 1px solid #000; }
  a[href^="http"]::after { content: " (" attr(href) ")"; }
}
```

Browser support, from the [web-features](https://github.com/web-platform-dx/web-features) Baseline data as of 2026-10-22: `oklch()` and `color-mix()` are Baseline widely available (since 2025-11-09); `@property` and `light-dark()` are newly available; scroll-driven animations (Chrome 115, Safari 26) and cross-document view transitions (Chrome 126, Safari 18.2) are not Baseline because Firefox lacks them, which is why both sit behind a working default; `prefers-reduced-transparency` is Chromium-only.

One alternative was considered and deferred: `light-dark()` with `color-scheme: light dark` would follow the OS with no script at all, and would define each token once. It reaches Baseline widely available around 2026-11 (newly available on 2024-05-13), and the stored choice still needs the pre-paint script, so it buys little today. Revisit when the token file is next restructured.

## Theme before first paint

The theme must be set before the first paint, or a visitor whose OS is light sees a dark flash. An inline script in `<head>` does it:

```html
<script>
(function () {
  var t;
  try { t = localStorage.getItem("theme"); } catch (e) {}
  if (t !== "light" && t !== "dark") {
    t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = t;
})();
</script>
```

Rules:

- **Its sha256 must be in the CSP**, or the browser blocks it and every light-mode visitor gets dark. Astro hashes the scripts it bundles but not `is:inline` scripts (tested in the framework research), so the hash goes into `security.csp.scriptDirective.hashes` ([Astro configuration reference](https://docs.astro.build/en/reference/configuration-reference/), as of 2026-10-22). One source: the script is one file; the layout inlines it and `astro.config` hashes the same file. Whitespace counts, so a hand-copied hash breaks on the first reformat. To check by hand: `printf '%s' "$SCRIPT" | openssl dgst -sha256 -binary | openssl base64`. [security.md](security.md) owns the policy and the config sketch.
- **Place it after Astro's CSP `<meta>`.** A policy delivered in a `<meta>` element does not apply to content that comes before it ([CSP Level 3](https://www.w3.org/TR/CSP3/)).
- **Fail-safe default.** If the script is blocked or throws, `:root` falls back to dark, which is the designed default, not a broken page. Storage access sits in `try`/`catch` because private modes and blocked storage throw.
- **`theme` is the only key the site stores** ([product.md](product.md) and the privacy notes in [security.md](security.md)). A boot sequence that remembered "seen it" would add a second key; that is one more reason it is deferred.
- **The toggle** (a separate module, not this script) cycles Dark, Light, System, and its button names the current state. While a choice is stored, the toggle reads "Theme: dark · saved in this browser" (or light), and so does the palette's theme entry. System deletes the key and the note: the button reads "Theme: system", and the page follows OS changes live. The visible note is what keeps a stored choice inside the consent exemption for interface preferences ([security.md](security.md#privacy-and-data-inventory)). Estimated at 0.3 KB; not measured yet.
- **Tested**: Playwright runs with `colorScheme: 'light'` and `'dark'`, empty and seeded storage, and asserts `data-theme` before the first paint plus zero CSP violations in the console. With seeded storage it also asserts that the toggle and the palette entry say "saved in this browser".

## Typography

### Options

Latin woff2 files, measured 2026-10-22 from the Fontsource CDN ([Fontsource API](https://api.fontsource.org/v1/fonts/inter)) and the vendors' releases. Glyph coverage was read from each file's cmap.

| Option | Files | Bytes | HUD glyphs (─ ▸ ● ✓ ✗ → ⌘) | License | Verdict |
|---|---|---|---|---|---|
| **Inter Variable + JetBrains Mono HUD subset** | 2 | 48,256 + 15,864 = **64,120** | all | OFL 1.1, no Reserved Font Name; $0 | **Recommended.** Continuity with Mission-AI; the mono face carries the HUD voice |
| Inter Variable + JetBrains Mono Variable (Fontsource latin defaults; what Mission-AI ships) | 2 | 48,256 + 40,404 = 88,660 | none (has only • · ↑ ↓ … °) | OFL 1.1 | box drawing falls back to a system mono with other widths; alignment breaks |
| Geist + Geist Mono (latin) | 2 | 29,400 + 23,128 = 52,528 | none; even the full Geist Mono in geist 1.8.2 ([npm](https://registry.npmjs.org/geist), published 2026-10-21) lacks ▸ ■ ✓ ✗ ⌘ | OFL 1.1 | smallest, but reads as Vercel's and breaks gitops' ▸ and ✓ |
| IBM Plex Sans Variable + Plex Mono 400 and 500 | 3 | 45,712 + 14,708 + 14,888 = 75,308 | not in the latin subset | OFL 1.1 | engineering-document voice; Plex Mono has no variable build |
| Inter with the `opsz` axis (Inter Display) | 1 | 72,920 (+24,664) | as Inter | OFL 1.1 | Linear's heading face; approximated with −0.03em tracking instead |
| Berkeley Mono | 1–2 | not measurable without a license | likely | commercial: Developer $75, personal use only, plus $45 for web fonts ([FX-102](https://usgraphics.com/catalog/FX-102)); Indie $225 plus $145 ([FX-202](https://usgraphics.com/catalog/FX-202)); commercial licenses "are not compatible with open-source apps". As of 2026-10-22, as quoted by a search engine: the vendor's pages refuse automated reads | no: it cannot live in a repo that will be public ([ADR 0012](adr/0012-public-repository.md)) |
| Geist Pixel Square (optional display face) | +1 | 28,540 | ASCII and arrows; no box drawing | OFL 1.1 | wordmark or 404 only, if ever |

Both recommended fonts are OFL 1.1 with no Reserved Font Name (checked in each license file), so a renamed subset is allowed. `OFL.txt` ships beside the files.

### The HUD subset

```sh
# Source: JetBrains Mono v2.304 release (2023-01-14), fonts/variable/JetBrainsMono[wght].ttf, OFL 1.1.
# https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304 (latest release as of 2026-10-22)
# Record the source file's sha256 next to the output; ship OFL.txt beside the woff2.
pyftsubset "JetBrainsMono[wght].ttf" \
  --unicodes="U+0020-007E,U+00A0,U+00B0,U+00B7,U+2013,U+2014,U+2018-201D,U+2022,U+2026,U+2190-2193,U+2318,U+2500-257F,U+25A0-25FF,U+2713,U+2717" \
  --layout-features="kern" --flavor=woff2 \
  --output-file=apps/web/public/fonts/jetbrains-mono-hud-wght.woff2
```

- **Size.** Plan for 15,864 B, the research figure. Re-cut from the pinned v2.304 release file with fontTools 4.67.0, the same command gives 15,744 B; the research had cut a development build that reports version 2.305. Keeping code ligatures (`calt`, `liga`) costs 32,868 B and draws `=>` as an arrow, which misreads in code, so they stay out.
- **Two glyphs are missing.** The terminal header's `›` (U+203A, in `gitops › status`) and the external-link `↗` (U+2197) are not in the range above. Adding both measured 16,020 B from the release file, 276 B more, and the total stays under the 70 KB font budget. The gap was found by hand while writing this doc; from PR 2 the glyph-coverage check ([Budgets](#budgets-as-ci-fitness-functions)) fails the build on any gap like it.
- **Some glyphs are not in JetBrains Mono at all**: `↵`, `◐` and the circled digits `①`. The palette writes "enter", the theme toggle uses an inline SVG, and the career timeline draws its markers in CSS.
- **Delivery.** Spike S9 ([roadmap.md](roadmap.md)) tests the Astro Fonts API's local provider (`fontProviders.local()`, which reads the file from `src/`) with this file. If it passes, the API writes the `@font-face` rules, the preload links (opt-in per font) and metric-matched fallback faces ([Astro fonts guide](https://docs.astro.build/en/guides/fonts/), as of 2026-10-22). If it fails, the file is served from `public/fonts/` and the rules are hand-written:

```css
/* Sketch, only if spike S9 fails. Preload both files; nothing else. */
@font-face {
  font-family: "Inter Variable";
  src: url("/fonts/inter-latin-wght.woff2") format("woff2");          /* 48,256 B */
  font-weight: 100 900; font-style: normal; font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F,
                 U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "JetBrains Mono HUD";                                   /* 15,864 B */
  src: url("/fonts/jetbrains-mono-hud-wght.woff2") format("woff2");
  font-weight: 100 800; font-style: normal; font-display: swap;
}
```

Self-hosting is not only about bytes. Since Chrome 86 the HTTP cache is partitioned per site ([Chrome](https://developer.chrome.com/blog/http-cache-partitioning)), so a shared Google Fonts cache gives no benefit. A third-party font also needs its own connection setup ([web.dev](https://web.dev/articles/font-best-practices), which calls the speed difference "less clear cut" in practice), and every request to it hands the visitor's IP address to another company.

### Type scale

A 1.25 ratio from 16px. Mission-AI's console used a 14px base; this site is read, so it starts at 16px.

| Token | Size | Line height | Tracking | Weight | Face | Use |
|---|---|---|---|---|---|---|
| label | 11px | 16px | +0.16em, uppercase | 500 | mono | `[01] WORK`, metric labels |
| meta | 12px | 16px | +0.02em | 400 | mono, tabular numerals | SHA, timestamps, telemetry |
| sm | 14px | 22px | 0 | 400 | sans | UI chrome, card copy |
| base | 16px | 26px | 0 | 400 | sans | prose, at most 68ch per line |
| lead | 18px | 28px | 0 | 400 | sans | hero sub-lines |
| h3 | 20px | 28px | −0.01em | 600 | sans | card titles |
| h2 | 22→25px | 1.2 | −0.015em | 600 | sans | section titles |
| h1 | 31→39px | 1.15 | −0.02em | 600 | sans | page and post titles |
| display | 39→61px | 1.05 | −0.03em | 650 | sans | the name in the hero |

Rules:

- Mono stays under about 15% of visible text: labels, meta, code and terminal panels only.
- Fluid sizes mix `rem` and `vw`, and each maximum is at most 2.5 times its minimum (display: 1.56), so 200% zoom still enlarges text (SC 1.4.4; Maxwell Barvian, ["Addressing Accessibility Concerns With Using Fluid Type"](https://www.smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type/), 2023-11-07).
- Numbers that line up (SHAs, versions, counts) use tabular numerals.

## HUD motifs

The cyber feel comes from structure. Each motif is CSS or real text, and each one survives with JavaScript off.

- **Hairline grid.** 1px lines every 32px at 5% white (dark) or 6% ink (light), with a cross at every fourth intersection, after Vercel's Geist Grid. A radial mask fades it out by mid-hero. Behind the hero only, never behind prose. It is decoration, so the non-text contrast rule does not apply, and a label crossing a line keeps 4.95:1.
- **Corner brackets.** 10px arms, 1px thick, drawn with eight background gradients on the card itself, so there is no extra DOM. At rest they sit 4px inside the corners in `subtle-foreground` (5.17:1 on a card). On hover or `:focus-within` they lock on to the corners and turn `primary` in 180 ms. Keyboard users get the same lock-on as mouse users.
- **Mono section labels.** `[01] WORK ──── <live fact>`. The number is `aria-hidden`; the word is real text uppercased by CSS, so a screen reader says "Work", not "W-O-R-K". The right side carries a fact in gitops' ` · ` grammar ("last release 2026-09-18"), never decoration. Numbers are assigned at build from the sections that render, so a hidden section leaves no gap.
- **Status LEDs.** An 8px dot with a 3px halo, in `ok`, `signal` or `off`. Always beside text that says the same thing (SC 1.4.1). A pulse runs at most 3 times, 3.6 s in total.
- **Metric tiles.** Mission-AI's anatomy: an 11px label over a 16px mono value with tabular numerals.
- **Terminal panel.** Dark in both themes; decorative traffic lights (`aria-hidden`); 13px mono; a key-help footer line. Content is real `<pre>` text, so it can be copied, searched, translated and read aloud. A screenshot can do none of that.
- **Telemetry strip.** One component, placed once per page: on Home it is the status line in row 2; on every other page it closes the footer and carries the deploy date, so no page needs a separate "updated" line. Its fields, in the copy [content.md](content.md) owns: `build <sha> · deployed <ISO date> · served from <colo> · <weight> KB`.
  - SHA, deploy date and page weight are written into the HTML at build. The date is a `<time datetime>` holding the build time in UTC, so no script touches it. Page weight is the first-view transfer size from the same byte check that enforces the Home budget, rounded to whole KB so writing it into the page does not change it.
  - The colo comes from one same-origin request after load, to `/cdn-cgi/trace`, which Cloudflare documents for identifying "the Cloudflare data center serving your request" and which is "managed and served by Cloudflare" ([/cdn-cgi/ endpoint](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/), as of 2026-10-22). The script reads only its `colo` line; the body also carries the visitor's IP address and country, which are never read. Cloudflare's docs do not say whether a Worker on the hostname sees that request, so PR 3 checks that Workers request metrics stay at 0. If they move, the fallback is the `CF-RAY` header of a same-origin `HEAD` for a static file (`cache: 'no-store'`): its suffix is the data center code, and its response carries no IP address ([Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)).
  - The field reserves its width in `ch`, so filling it shifts nothing. A value that cannot be read is left out, never faked.
  - **Pause.** The strip ships with its pause control, inside its 0.66 KB, and the control renders wherever a value on the strip can change by itself (SC 2.2.2). At launch none can: once the colo is filled the strip is static, and a button that pauses nothing would be one more tab stop on every page. The first live value is Presence's "N here now" count, on lab pages only ([lab.md](lab.md)). A site-wide count would put Worker and Durable Object requests on every page view and end the zero-invocation page view ([ADR 0008](adr/0008-workers-free-with-guardrails.md)), so it is an open decision, Q28 · Q-live-count in [product.md](product.md), recommended against.
- **Timestamps.** ISO 8601 in UTC (`2026-10-22 18:04 UTC`) inside `<time datetime>`. No ticking clock: a clock is auto-updating content under SC 2.2.2, and it says nothing about the work.
- **Removed: coordinates and a fixed UTC offset.** The research wireframe put one-decimal coordinates and a UTC offset in the hero label. Both are gone. One decimal of latitude and longitude resolves to about 11 km, which is city scale; next to a title, years and an industry, that narrows the search to one employer, which is the mosaic effect the content firewall exists to prevent ([ADR 0007](adr/0007-content-firewall.md)). A fixed offset is also wrong for half the year: a US offset moves by one hour at each daylight saving change (the next one is 2026-11-01), so a static label goes stale twice a year. The hero carries only the location line Joseph chooses (Q5 · Q-location in [product.md](product.md)).

## Motion

| Kind | Duration and easing | With `prefers-reduced-motion: reduce` |
|---|---|---|
| Palette and terminal open and close | 0 ms | same |
| Hover color, focus | 120 ms, ease-out | kept (color only, no movement) |
| Popover, bracket lock-on | 180 ms, ease-out; exits about 20% shorter | brackets jump to the locked state; no fade |
| Theme switch | 240 ms crossfade | instant |
| Label decode | at most 600 ms in total, once per label | skipped; the final text shows |
| Diagram draw | scroll-linked, from 10% into view to 40% covered | fully drawn |
| LED pulse | 1.2 s, 3 times, then still | still |
| Page-to-page view transition | 150–200 ms crossfade | none |

Rules:

- **Author motion inside `prefers-reduced-motion: no-preference`** (no-motion-first). State changes live outside the query, so a reduced-motion visitor still sees the lock-on; only the movement is removed.
- **Animate `transform` and `opacity`.** Paint-only changes (color, `background-position`) are allowed on small elements for at most 180 ms. Never animate layout properties such as width, height, margin or top.
- **Nothing moves for more than 5 s without a pause control** (SC 2.2.2). **Nothing flashes more than 3 times a second** (SC 2.3.1).
- **No motion on body copy, and never on the LCP element.** The hero name is the likely LCP element; it is never decoded, faded or delayed.
- **One moving thing on screen at a time. No bounce or elastic easing.**
- **Keyboard-driven UI opens instantly, and frequent actions animate less** (Rauno Freiberg, see [Prior art](#prior-art)). The palette has no open animation because it is opened dozens of times a session by the people who use it.

## Effects catalog

JS sizes were measured on the research prototypes on 2026-10-22. CI re-measures the real files ([Budgets](#budgets-as-ci-fitness-functions)).

### Launch

| Effect | Where | How | JS | Accessibility | Obnoxiousness risk |
|---|---|---|---|---|---|
| ⌘K / Ctrl+K command palette | every page, plus a visible ⌘K button | `<dialog>` with a combobox and a listbox; subsequence match over the nav manifest | 1.18 KB | modifier shortcut only (SC 2.1.4); native focus handling and Esc; focus returns to the opener; `aria-activedescendant`; opens in 0 ms | Low |
| One-time label decode | section labels, on first view; never the h1 or prose | IntersectionObserver and `requestAnimationFrame`; mono glyphs keep their width, so nothing shifts; at most 600 ms, once | 0.57 KB | real text stays in the DOM; the overlay is `aria-hidden`; skipped under reduced motion; hidden in forced colors | Low on labels; high on headings or if it loops |
| Bracket lock-on and outline focus | cards; everything focusable | CSS: eight gradients and `@property --bc` | 0 | the 2px outline is the focus indicator and the brackets are decoration; jumps without motion under reduce; `Highlight` in forced colors | Low |
| Static scanlines | the hero terminal panel, dark theme only | CSS repeating gradient at 4% | 0 | static, so no flash; panel text stays at 5.32:1 or more; removed in light, `prefers-contrast: more`, forced colors and print | Low static; high as animated flicker |
| Draw-on-scroll | one diagram: "how this site runs" on `/colophon/` | CSS scroll-driven animation; IntersectionObserver fallback for Firefox; paths with `pathLength="1"` | 0.31 KB (the fallback only) | fully drawn by default and under reduce; the SVG has `<title>` and `<desc>`, and the same facts are in the prose | Low to medium |
| Telemetry strip | Home: row 2. Other pages: the footer | build facts in the HTML; colo from `/cdn-cgi/trace` | 0.66 KB | `aria-live` off; static once the colo is filled; pause control wherever a value can change; LED plus text | Low static; medium if numbers tick |
| Cross-document view transitions | page to page | `@view-transition { navigation: auto; }` inside no-preference ([ADR 0003](adr/0003-astro-static-first.md)) | 0 | none under reduce; Firefox navigates normally | Low |
| Terminal recordings | gitops' case study (PR 4) | freeze SVG or HTML `<pre>` first; a VHS video, click-to-play, with a poster | 0 | the commands also appear as text; no autoplay loop (SC 2.2.2) | Low |

Eager JS on a content page: palette, decode and telemetry on every page, plus the draw fallback on `/colophon/`. As one bundle the four measure 2,172 B (2,159 to 2,186 B, depending on file order); as four files, 2,722 B. Both are under the 5 KB budget, before the inline theme script (257 B uncompressed) and the toggle.

### Deferred

| Effect | Ships when | JS | Accessibility | Risk |
|---|---|---|---|---|
| Terminal mode: `help`, `ls`, `open`, `cat about`, `whoami`, `theme`, `clear`, `exit` | after launch; opened from the palette or with `` Ctrl+` `` | 1.12 KB, lazy (0 until opened) | output in `role="log"`; labelled input; never the only path; the palette entry comes first because backtick is a dead key on some keyboard layouts | low noise; the risk is cringe |
| Live "N here now" count | with Presence (PR 6), in the strip on lab pages only ([lab.md](lab.md), [ADR 0009](adr/0009-lab-worker-same-origin.md)) | inside the strip, plus a WebSocket | pause control (SC 2.2.2); disconnects when the tab is hidden; aggregate counts only, never anyone's location | medium if it ticks |
| Opt-in multiplayer cursors | with Presence, on lab pages | 0.73 KB, lazy | `aria-hidden`, `pointer-events: none`, off by default, only with `(hover: hover) and (pointer: fine)`; no names, no locations | medium; low when opt-in |
| One-shot label glitch on card hover | optional, if reviewers find the cards flat | 0 (CSS: 240 ms, `steps(3)`) | hover devices and no-preference only; runs once; the label (about 4,800 px²) is far under SC 2.3.1's flash-area limit of 21,824 px² (25% of the 341 × 256 px field WCAG uses at 1024 × 768) | medium: it animates a frequent action |
| Boot sequence | inside the hero panel only, if ever | 0.44 KB | `aria-hidden`; skipped on any key, click or reduce; never full-screen, so never the LCP element; needs a second storage key | medium in the panel; high full-screen |

### Rejected

| Option | Why not |
|---|---|
| Arwes, the sci-fi UI framework | Its README says "The ARWES project is no longer maintained and currently outdated" and that it "does not work with React strict mode nor React Server Components"; `@arwes/react` 1.0.0-next.25020502 (2025-02-05) peers React 18 ([github.com/arwes/arwes](https://github.com/arwes/arwes), [npm registry](https://registry.npmjs.org/@arwes/react), as of 2026-10-22); 27.3 KB plus React on every page |
| cmdk for the palette | 16.3 KB for cmdk 1.1.1, plus about 68 KB of React 19 on a page that has no React: about 84 KB against 1.18 KB ([dip/cmdk](https://github.com/dip/cmdk), as of 2026-10-22). Worth it only on a page that already ships React |
| augmented-ui for clipped corners | 15.8 KB of CSS for corners that eight gradients draw; last release 2.0.0 on 2020-08-30 ([augmented-ui](https://github.com/propjockey/augmented-ui), as of 2026-10-22) |
| asciinema-player | 65.2 KB of JS and 3.9 KB of CSS, lazy, against a 2 KB lazy budget (3.17.0, [asciinema-player](https://github.com/asciinema/asciinema-player), as of 2026-10-22). VHS and freeze ship 0 KB. Revisit only with an ADR that amends the budget |
| Full-screen boot screen | the LCP waits on an animation; it hides the content the 7-second scan needs |
| Looping glitch or CRT flicker | flash risk (SC 2.3.1), needs a pause control (SC 2.2.2), and it competes with the text |
| Autoplay audio | SC 1.4.2 Audio Control, and sound that nobody asked for |
| WebGL hero | GPU and battery cost on every visit, an LCP risk, and it carries no information; not measured, because nothing about it passes the "real data" test |
| Scroll-jacking | it breaks native scrolling, keyboard paging and reduced-motion settings |

Adding an effect needs a row in this catalog with its measured bytes, and the budgets below must still pass. Raising a budget to fit an effect needs an ADR. Each effect is cheap alone; the risk is the sum, which is how a site ends up reading as a gimmick.

## Budgets as CI fitness functions

A fitness function is an automated check that an architectural characteristic still holds (Building Evolutionary Architectures, ch. 2). These turn "fast and accessible" from a review opinion into a failing build. [delivery.md](delivery.md) owns the job graph; this table owns the limits.

| Budget | Hard limit | Target | Measured 2026-10-22 | Check | Job |
|---|---|---|---|---|---|
| Eager JS on a content page (gzip) | ≤ 5 KB | — | 2.2 KB as one bundle, 2.7 KB as four files | byte check on `dist/` | `verify` |
| Lazy JS per feature (gzip) | ≤ 2 KB | — | terminal 1.12 KB, cursors 0.73 KB | byte check | `verify` |
| CSS (gzip, with preflight) | ≤ 15 KB | — | 4.39 KB on Tailwind 4.3.3 | byte check | `verify` |
| Preloaded fonts | ≤ 70 KB | — | 64.1 KB | byte check | `verify` |
| Home transfer, first view | ≤ 150 KB | — | not built yet | Lighthouse CI against the preview | `e2e` |
| Contrast | AA for every text and non-text token against every surface, both themes | — | 25/25 declared pairs; cross product 33/33 dark, 32/33 light | Vitest with [culori](https://culorijs.org/api/) (`wcagContrast`, `inGamut`; 4.0.2, MIT, as of 2026-10-22), reading `tokens.css` | `verify` |
| Gamut | every `oklch()` value inside sRGB | — | site tokens pass; two research terminal values did not, so they are hex now | same test | `verify` |
| Raw colors | no color literal outside `tokens.css` | — | — | a grep for `oklch(`, `rgb(` and `#rrggbb` in components | `verify` |
| Glyph coverage | every character inside mono text exists in the HUD subset | — | `›` and `↗` missing from the research subset | read the built HTML, compare with the subset's cmap | `verify` |
| Fold | the bottom edge of Home's row 3 at or above the bottom of the viewport at 390×844 and 1440×900 ([content.md](content.md#home-page) defines it) | — | not built yet; the wireframes use about 726 px of 844 and 670 px of 900 | Playwright; once in Safari on a real phone in PR 3 | `e2e` |
| LCP, p75 mobile | ≤ 2.5 s | 1.5 s | not built yet | Lighthouse CI on simulated mobile (the gate); Web Analytics field data (the evidence) | `e2e`; monthly review |
| CLS | ≤ 0.1 | 0.05 | not built yet | same | `e2e`; monthly review |
| INP | ≤ 200 ms | 100 ms | not built yet | field data only; Total Blocking Time is the lab proxy | monthly review |
| axe | 0 violations | — | — | `@axe-core/playwright` in light, dark, forced colors and `contrast: 'more'` | `e2e` |
| Theme before first paint | `data-theme` set before the first paint; 0 CSP violations; with a stored choice, the toggle and the palette entry say "saved in this browser" | — | — | Playwright `colorScheme` light and dark, with empty and seeded storage | `e2e` |
| Reduced motion | no running animation under `reduce` | — | — | Playwright `reducedMotion: 'reduce'`: [`document.getAnimations()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations) is empty after load and after hovering a card | `e2e` |

Lab data gates the merge; field data says whether the gate was right. Cloudflare Web Analytics rates LCP, INP and CLS from real page loads as Good, Needs Improvement or Poor, and its debug view lists the worst elements at P75 ([Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/), as of 2026-10-22). Its docs do not say whether it gives a site-wide p75 to compare with the limits above, so PR 3 settles how that number is read ([delivery.md](delivery.md)). INP needs real interactions, so no lab tool measures it directly. Playwright's emulation covers every media query the token sheet handles: `colorScheme`, `reducedMotion`, `forcedColors`, `contrast` (1.51+) and `media: 'print'` ([Playwright](https://playwright.dev/docs/api/class-page#page-emulate-media)).

Why it matters: low-contrast text is the most common accessibility failure on the web, found on 83.9% of the top million home pages ([WebAIM Million 2026](https://webaim.org/projects/million/), as of 2026-10-22). Mission-AI's focus ring shows how it happens: a style guide said AA, and nothing measured it.

## Accessibility rules

Target: WCAG 2.2 AA. The first six rows are the ones the effects would break.

| Rule | WCAG 2.2 SC (level) | Where it applies | How it is met | Check |
|---|---|---|---|---|
| Auto-updating content can be paused | [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) (A) | telemetry strip once a value is live; LED pulse; recordings | pause control; pulse at most 3.6 s; recordings click-to-play | e2e asserts a pause control wherever a value can change |
| No single-character shortcuts | [2.1.4 Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html) (A) | palette, terminal | ⌘K or Ctrl+K, and `` Ctrl+` ``; nothing on a bare key | unit test on the key handler |
| Three flashes or fewer per second | [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) (A) | label decode; any future glitch | the decode runs once in at most 600 ms; nothing loops | review |
| The sticky header never hides focus | [2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) (AA) | the 56px sticky header | `scroll-padding-top` of the header height plus 1rem | e2e tabs through Home and checks that no focused element sits under the header |
| UI parts and focus contrast 3:1 | [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) (AA) | focus outline, input borders, LEDs | outline 11.20:1 / 5.03:1; `input` 3.21–3.65:1; `ok` 4.81:1 or more | the contrast test |
| Color is never the only signal | [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) (A) | LEDs, status badges, terminal colors | every LED sits beside a word; `✓` and `✗` beside green and red | review; axe catches part of it |
| Text contrast 4.5:1 | [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) (AA) | all text tokens | the tables above | the contrast test and axe |
| Focus is visible | [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) (AA) | everything focusable | the 2px outline; never `outline: none` without a replacement | review and keyboard pass |
| Targets at least 24 × 24 px | [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (AA) | buttons, nav links, toggles | 44px targets on touch (Mission-AI's rule) | e2e bounding-box check |
| No sideways scrolling at 320 px | [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) (AA) | terminal panels, tables | panels scroll inside themselves | e2e at 320px: page `scrollWidth` ≤ viewport width |
| Text zooms to 200% | [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) (AA) | fluid type | max ≤ 2.5 × min | review |
| Name, role and value | [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html) (A) | palette, theme toggle | native `<dialog>`, labelled combobox, `aria-activedescendant`; the toggle names its state | axe plus manual VoiceOver and NVDA passes |
| Status messages are announced | [4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) (AA) | "Copied" after copying the email address | `role="status"` | axe and manual |
| No audio | [1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html) (A) | everywhere | the site plays no sound | — |
| Motion from interactions | [2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) (AAA, not required) | all motion | honored anyway: no-motion-first | e2e under `reduce` |

Manual checks on every PR that changes UI (the PR template carries them): a keyboard-only pass; VoiceOver on macOS and NVDA on Windows over the palette and the theme toggle; reduced motion on; light mode reviewed as carefully as dark, because a recruiter on a light-mode laptop sees light first when the site follows the OS.

## One nav manifest

One file, generated at build, feeds every way of getting around. The weaker design gives the header, the palette and the sitemap their own lists; the third copy drifts the first time a page is renamed.

```json
{
  "motd": "ihaveasegway.com · type to search",
  "whoami": "<name> · <title line — Q-title>",
  "items": [
    { "id": "home",     "label": "Home",                         "href": "/",           "group": "Go to" },
    { "id": "work",     "label": "Work",                         "href": "/work/",      "group": "Go to", "nav": true, "keywords": "projects case studies gitops stillhere" },
    { "id": "about",    "label": "About",                        "href": "/about/",     "group": "Go to", "nav": true },
    { "id": "now",      "label": "Now",                          "href": "/now/",       "group": "Go to" },
    { "id": "colophon", "label": "Colophon: how this site runs", "href": "/colophon/",  "group": "Go to", "keywords": "architecture adr decisions cloudflare astro" },
    { "id": "theme",    "label": "Theme: system",                "action": "theme",     "group": "Actions", "labelFrom": "toggle", "keywords": "toggle dark light system" },
    { "id": "email",    "label": "Copy email address",           "action": "copy-email", "group": "Actions" },
    { "id": "github",   "label": "GitHub",                       "href": "https://github.com/IHaveASegway", "group": "Links" }
  ]
}
```

Sketch: confirm against current docs when building.

- **Writer**: the build, from the route list and the content collections. The only hand-written parts are the actions and the external links. A page that does not exist cannot appear, so the header's rule "a section shows only when it has content" ([ADR 0005](adr/0005-url-scheme.md), [content.md](content.md)) is enforced by construction.
- **Readers**: the header (items with `nav: true`), the palette (everything), terminal mode later (`ls`, `open`, `whoami`, `motd`), and a sitemap check: every internal `href` must be in the generated sitemap, and every sitemap page must be in the manifest or on a short exclusion list (`/404`).
- **Runtime label**: the theme entry's label is set at runtime by the toggle module, which `labelFrom` names. The manifest holds "Theme: system", which is right while nothing is stored; while a choice is stored, the module swaps in "Theme: dark · saved in this browser" (or light), so the palette entry and the toggle always match ([Theme before first paint](#theme-before-first-paint)). `keywords` keeps the entry findable by "toggle", "dark" or "light" in every state.
- LinkedIn joins the links only if Q3 · Q-threat-model allows it ([product.md](product.md)).

## Wireframes

Home, desktop (about 1440px wide). This is the state after PR 4, when Work and About exist. Text in angle brackets is a placeholder for an open decision or for copy that [content.md](content.md) owns. The boxes were generated by a script so they align in a monospace font; a few glyphs (● ✓ ↗) may render slightly wider in some fonts.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ihaveasegway_ (1)            work    about                 [ ⌘K  Search ]  [ Theme: system ]     │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ +           +           +           +           +           +           +           +       (2)  │
│   ┌─                                        ─┐                                                   │
│     [00] WHOAMI ─────────────────────────────    ┌ ● ● ●  gitops › status ──────────────────┐    │
│                                                  │ ~/<org> · 5 repos · 3 dirty · 2 ahead    │    │
│     <name>                                (3)    │ ✓ <repo 1>      [main] clean             │    │
│     <title line — Q-title>                       │ ✓ <repo 2>      [main ↓2] 1 changed      │    │
│     <arc line — Q-career-arc>                    │ ✓ <repo 3>      [main ↑2 ↓1] 2 changed   │    │
│     <proof line — content.md>                    │ Total: 5  ✓ 5  ✗ 0                       │    │
│     <location line — Q-location>                 │ ↑/↓ move · enter select · q quit     (4) │    │
│                                                  └──────────────────────────────────────────┘    │
│     [ Work ↓ ] [ Email ] [ GitHub ] [ LinkedIn ]                                                 │
│     ● <availability line — Q-availability>                                                  (5)  │
│   └─                                        ─┘                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ build <sha> · deployed <ISO date> · served from <colo> · <weight> KB                        (6)  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [01] AT A GLANCE ─────────────────────────────────────────────────────── <yyyy> → now       (7)  │
│                                                                                                  │
│   ○───────────────○───────────────○──────── ··· ────────○━━━━━━━━━━━━━━━━● now                   │
│   <role 1>        <role 2>        <role 3>              <role n-1>       <role n>                │
│   <yyyy>          <yyyy>          <yyyy>                <yyyy>           <yyyy>                  │
│                                                                                                  │
│   <stack line — profile.json>   ·   <full history on LinkedIn — Q-threat-model>                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [02] WORK ─────────────────────────────────────────────────── last release <yyyy-mm-dd>     (8)  │
│                                                                                                  │
│   ┌─                         ─┐   ┌─                         ─┐   ┌─                         ─┐  │
│     stillhere   [PRE-RELEASE]       gitops             [LIVE]       this site          [LIVE]    │
│     <line — content.md>             <line — content.md>             <line — content.md>          │
│     ADRS   STATUS                   RELEASE   CHECKSUMS             ADRS   JS ON THIS PAGE       │
│     15     pre-release              v1.2.1    signed                <n>    <js> KB               │
│   └─                         ─┘   └─                         ─┘   └─                         ─┘  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [03] HOW I WORK ──────────────────────────────────────────────────────────────────────      (9)  │
│   <four lines, each linked to its evidence — content.md>                                         │
│                                                                                                  │
│   LAB renders only while a demo is live. WRITING renders at 3 or more posts.               (10)  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ email · GitHub ↗ · LinkedIn ↗ · RSS · now · colophon · ⌘K                                  (11)  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. Mono wordmark with a static caret. The 56px header is sticky, with a hairline border and the `.glass` background. The ⌘K button reads "Ctrl K" outside macOS. The nav lists only sections that have content. The theme button names its state: "Theme: system" as drawn, "Theme: dark · saved in this browser" (or light) while a choice is stored ([Theme before first paint](#theme-before-first-paint)).
2. Hairline grid with crosses every 4 cells, hero only, faded out by mid-hero.
3. Hero lines are placeholders until Joseph answers Q4 · Q-title, Q8 · Q-career-arc and Q5 · Q-location. `[00]` is `aria-hidden`. No coordinates and no UTC offset. LinkedIn renders only if Q3 · Q-threat-model allows it.
4. Terminal panel: `<pre>` text from a fixture organization made for this site, dark in both themes, static 4% scanlines in dark. Fixture names are invented here, pass the [firewall classes](content.md#firewall-classes-for-copy), and are never copied from another repository's README, tests or recordings. It sits beside the hero on desktop and moves below Work on mobile, so rows 1–3 stay above the fold.
5. LED plus text. If Q6 · Q-availability stays "none", the line shows the latest gitops release, read from GitHub at build time.
6. The telemetry strip as Home's row 2. Static facts; only the colo fills in after load.
7. The career timeline, labelled "At a glance": placeholder markers. The number of markers, the titles and the years come from `profile.json` once Q8 is answered, and that file has no employer field to show ([ADR 0004](adr/0004-content-as-code.md)). "now" is in `signal` amber; the heavy segment is the current role. Markers are CSS circles. The line is drawn at rest; it is not the scroll-drawn diagram.
8. Bracket lock-on on hover and focus. Values are mono tabular numerals from GitHub at build time; the card for this site links to `/colophon/`.
9. Four lines from [content.md](content.md), each linked to its evidence.
10. A hidden section renders nothing, not a "coming soon" placeholder. The note is in the wireframe, not on the page.
11. Footer from [content.md](content.md), with no separate "updated" line: on Home the deploy date is in row 2, and on every other page the telemetry strip closes the footer and carries it.

Vertical budget at 1440×900: header 56px, hero about 380px, status line about 40px, At a glance about 190px, about 670px in total, so rows 1–3 fit.

Home, mobile (390px wide):

```
┌──────────────────────────────────────┐
│ ihaveasegway_         [⌘K] [ Menu ]  │ (1)
├──────────────────────────────────────┤
│ [00] WHOAMI ───────────────────────  │
│                                      │
│ <name>                               │ (2)
│ <title line — Q-title>               │
│ <arc line — Q-career-arc>            │
│ <proof line — content.md>            │
│ <location line — Q-location>         │
│                                      │
│ [   Work ↓    ] [    Email     ]     │ (3)
│ [  GitHub ↗   ] [  LinkedIn ↗  ]     │
│ ● <availability — Q-availability>    │
├──────────────────────────────────────┤
│ build <sha> · deployed <ISO date>    │ (4)
│ served from <colo> · <weight> KB     │
├──────────────────────────────────────┤
│ [01] AT A GLANCE ─── <yyyy> → now    │ (5)
│ ○ <role 1>                   <yyyy>  │
│ ○ <role 2>                   <yyyy>  │
│ ┆ …                                  │
│ ● <role n>               <yyyy> now  │
│ <stack line — profile.json>          │
├──────────────────────────────────────┤
│ [02] WORK                            │ (6)
│ ┌─                             ─┐    │
│   stillhere       [PRE-RELEASE]      │
│   15 ADRs · pre-release              │
│ └─                             ─┘    │
│ ┌─                             ─┐    │
│   gitops                 [LIVE]      │
│   v1.2.1 · signed checksums          │
│ └─                             ─┘    │
│ ┌─                             ─┐    │
│   this site              [LIVE]      │
│   <n> ADRs · <js> KB JS              │
│ └─                             ─┘    │
├──────────────────────────────────────┤
│ ┌ ● ● ● gitops › status ──────────┐  │ (7)
│ │ ✓ <repo 1>    [main] clean      │  │
│ │ ✓ <repo 2>    [main ↓2] 1 chan… │  │
│ └─────────────────────────────────┘  │
├──────────────────────────────────────┤
│ [03] HOW I WORK · same anatomy       │ (8)
│ email · GitHub ↗ · LinkedIn ↗ · RSS  │
│ now · colophon                       │
└──────────────────────────────────────┘
```

1. 52px header: ⌘K opens the palette; Menu opens a sheet with the same manifest items.
2. The display size is about 41px at 390px wide, so the name may wrap to two lines.
3. A 2 × 2 grid of 44px targets (Mission-AI's rule; the floor in SC 2.5.8 is 24px). Four stacked full-width buttons would push At a glance below the fold.
4. The strip wraps to two lines.
5. The timeline turns into a compact vertical list; the filled dot marks the current role.
6. Cards stack. No hover effects on touch.
7. The terminal panel comes after Work, clipped, and scrolls inside itself; the page never scrolls sideways (SC 1.4.10).
8. The remaining sections keep the same anatomy.

Vertical budget at 390×844: header 52px, hero about 430px (name on two lines, 2 × 2 buttons), strip about 44px, At a glance about 200px with up to six markers: about 726px of 844px.

Command palette (⌘K or Ctrl+K). Its footer reuses gitops' key-help grammar:

```
┌──────────────────────────────────────────────────────────┐
│ > ▌ search pages and actions                         esc │
├──────────────────────────────────────────────────────────┤
│ GO TO      ▸ Work                               enter    │
│ GO TO        About                                       │
│ GO TO        Now                                         │
│ GO TO        Colophon: how this site runs                │
│ ACTIONS      Theme: dark · saved in this browser         │
│ ACTIONS      Copy email address                          │
│ LINKS        GitHub ↗                                    │
│ LINKS        LinkedIn ↗                                  │
├──────────────────────────────────────────────────────────┤
│ ↑/↓ move · enter open · esc close                        │
└──────────────────────────────────────────────────────────┘
```

- A `<dialog>` with a labelled combobox and a listbox; `aria-activedescendant` follows the `▸` row; Esc closes it and focus returns to whatever opened it.
- It opens in 0 ms. Subsequence matching runs over each label and its keywords; results stay grouped as GO TO, ACTIONS and LINKS.
- The theme entry reads the same as the toggle; this sketch shows a stored choice ([One nav manifest](#one-nav-manifest)).
- "enter" is spelled out: `↵` is not in JetBrains Mono. The `▌` in the sketch is the input's own caret, not a character: block elements (U+2580–259F) are outside the HUD subset.
- Copy email address confirms with "Copied" in a `role="status"` region (SC 4.1.3). The address waits on Q2 · Q-mail.
- LinkedIn appears only if Q3 · Q-threat-model allows it.

## Prior art

| Source | What it does | What Quiet Console takes | What it leaves |
|---|---|---|---|
| [Vercel Geist Grid](https://vercel.com/geist/grid) | hairline guides, crosses at intersections, solid cells that hide the guides they cover | the hero grid and its crosses | the Geist fonts: the smallest pair (52,528 B), but Geist Mono lacks ▸ ■ ✓ ✗ ⌘, and the pair reads as Vercel's |
| Linear, ["How we redesigned the Linear UI (part II)"](https://linear.app/now/how-we-redesigned-the-linear-ui) (2024-03-28) | themes generated in LCH from three inputs (base color, accent color, contrast) instead of 98 variables per theme; Inter Display for headings | the model: a few inputs, and generated variants such as the `prefers-contrast: more` set | Inter Display, which costs 24,664 B more |
| Charm: [VHS](https://github.com/charmbracelet/vhs) (v0.12.1, 2026-09-24) and [freeze](https://github.com/charmbracelet/freeze) (v0.2.2, 2025-04-01), as of 2026-10-22 | scripted terminal recordings (`.tape` to gif, mp4 or webm) and static terminal images (PNG, SVG, WebP) | gitops is built on Charm's libraries, so its own toolchain records it, with 0 KB of JS on the page | autoplay loops |
| Rauno Freiberg, ["Invisible Details of Interaction Design"](https://rauno.me/craft/interaction-design) (2023) | interaction craft; on motion, that an interaction repeated hundreds of times a day turns animation into "cognitive burden", and that removing motion from core interactions made him feel he was "moving much faster" | 0 ms palette and terminal; motion only on rare actions | — |
| Stripe, ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems) | perceptual color tooling with contrast feedback built into how colors are chosen | the contrast check as a CI test computed from the tokens | — |
| [Arwes](https://github.com/arwes/arwes) | the canonical sci-fi web UI framework | nothing; a mood reference at most | the framework: unmaintained, React 18 only, no strict mode |
| Brittany Chiang, [v4 portfolio](https://github.com/bchiang7/v4) | teal `#64ffda` on navy `#0a192f` with numbered mono headings | nothing: this is the look to avoid | its green (gitops' ANSI 86 is ΔE 0.0054 from it) |

## Open decisions this doc depends on

The list and the recommendations live in [product.md](product.md#open-decisions).

| Question | What it changes here |
|---|---|
| Q25 · Q-token-owner | whether the neutrals are Mission-AI's values, copied, or re-derived from Tailwind's zinc scale ([ADR 0010](adr/0010-quiet-console-design-tokens.md)) |
| Q28 · Q-live-count | whether the telemetry strip ever carries a live count outside lab pages (recommended: no) |
| Q17 · Q-accent | teal (recommended) or amber as the lead color; recognition starts at launch, so settle it before PR 3 ([ADR 0010](adr/0010-quiet-console-design-tokens.md)) |
| Q16 · Q-theme | follow the OS (recommended), or dark only |
| Q4 · Q-title, Q8 · Q-career-arc | the hero lines and the career timeline's markers |
| Q5 · Q-location, Q6 · Q-availability | the hero's location line and LED line |
| Q3 · Q-threat-model | the LinkedIn button, link and palette entry |
| Q21 · Q-segway | how far the wordmark and the 404 page lean into the name; any glyph is a generic scooter |

## Patterns and further reading

Each pattern also has one canonical source in [reading-list.md](reading-list.md).

- Three-tier design tokens (primitive, semantic, component): Nathan Curtis, ["Naming Tokens in Design Systems"](https://nathanacurtis.substack.com/p/naming-tokens-in-design-systems-9e86c7444676).
- OKLab and OKLCH, perceptual color: Björn Ottosson, ["A perceptual color space for image processing"](https://bottosson.github.io/posts/oklab/); Evil Martians, ["OKLCH in CSS: why we moved from RGB and HSL"](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl).
- Accessible color systems: Stripe, ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems).
- No-motion-first: Tatiana Mac, ["prefers-reduced-motion: Taking a no-motion-first approach to animations"](https://www.tatianamac.com/posts/prefers-reduced-motion).
- Motion durations: NN/g, ["Executing UX Animations: Duration and Motion Characteristics"](https://www.nngroup.com/articles/animation-duration/).
- Progressive enhancement (scroll-drawn diagrams, view transitions and the palette all sit on a page that works without them): Jeremy Keith, [*Resilient Web Design*](https://resilientwebdesign.com/).
- Fitness functions: Neal Ford, Rebecca Parsons, Patrick Kua and Pramod Sadalage, [*Building Evolutionary Architectures*, 2nd ed., ch. 2](https://www.oreilly.com/library/view/building-evolutionary-architectures/9781492097532/ch02.html).
- Fail-safe default (dark if the theme script fails; a field left out if its value cannot be read): Jerome Saltzer and Michael Schroeder, ["The Protection of Information in Computer Systems"](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html) (1975).
- One owner per piece of data (tokens in one file, navigation in one manifest, theme choice in the visitor's browser): Andrew Hunt and David Thomas, *The Pragmatic Programmer*, 20th anniversary ed., "DRY: The Evils of Duplication".
- Mosaic effect (why the coordinates and the UTC offset are gone): US Office of Management and Budget, [Memorandum M-13-13](https://obamawhitehouse.archives.gov/sites/default/files/omb/memoranda/2013/m-13-13.pdf) (2013).
- WCAG 2.2: the W3C Understanding documents linked in [Accessibility rules](#accessibility-rules).
