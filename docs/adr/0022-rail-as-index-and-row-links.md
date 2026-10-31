# ADR 0022: The rail as an index of the site, and rows that are links

Status: Proposed · 2026-10-29 · Deciders: Joseph Peterson · Amended by [ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md): each item's leaves drop down when pressed, closed until then · Amended by [ADR 0025](0025-signal-box-identity.md): the rail does not name Joseph on Home, whose `<h1>` is the name, and a row's sweep runs in its lab's line

## Context

On 2026-10-29 Joseph read the site in production and asked for three things:

- "the side nav bar is huge and stuff in the lab and what not are not in it". The rail ([ADR 0021](0021-rail-and-living-ground.md)) gave 14rem of the window to three links. A demo was two presses away, through `/lab/`, and on Home the top of the rail was empty.
- "the side bar could have a search when we have enough lab demos or just list recent or newest labs or all".
- "rows on almost every page are not clickable which is lame and you have to click the try no or whatever button which is not apperant to users". The cards on Home already swept their 2 px bar under the pointer, the sign that a card leads somewhere, but only the small "Try it" link under the text answered a press. On `/lab/` and `/writing/` only a title did.

He named syntaqx.com as the reference, as "syntaqx.io", a name that does not resolve; the site is at syntaqx.com.

He also found a bug: on a page shorter than the window's 900 px drawing, such as `/lab/` on a laptop, the page scrolled on past its footer into an empty band, and the rail stopped partway down.

## Decision

### The rail is an index

**From 80rem the rail lists what the site holds, not only its sections.**

- **The name heads it on every page**, Home included, with the title under it. Below 80rem Home still has no name in its header row, since Home's `<h1>` is the name.
- **A search field** stands under the name. It opens the command menu, which now also finds every demo and every post. Search is the command menu, not a second tool.
- **Each nav item lists its leaves** under a hairline: every demo under Lab, and the three newest posts under Writing. The page on screen carries the 2 px bar, standing on the hairline.
- **The foot names its controls in words**: "Pause motion", "Theme: system". Joseph listed the bare glyphs as an iteration item on 2026-10-29.
- **The nav scrolls inside the rail** when the window is too short for it, so the foot stays in reach.
- **Below 80rem nothing changes.** The leaves and the search field are rail-only, and the header row keeps its three links and the command menu's keys.

The leaves come from the same areas the pages are built from (`lib/nav.ts`, `railLeaves`). So a leaf's page exists by construction, as every manifest item's does.

**Every demo, not the newest.** A demo has no date: its front matter has no `published` field, and adding one means editing each lab entry, which needs Joseph's review stamp. With two demos, every demo is the newest. The rail lists them all until they stop fitting (see Revisit if).

### Search is the command menu, with two more groups

The menu gains a Lab group and a Writing group: every demo and every published post. A title is found word by word, or whole. A summary is found only whole, because across a summary's dozen words a subsequence finds almost anything ("rsm" in "Four locks, none of them closed"). Enter goes to the first row that holds the query whole, so "bak" opens the bakery, not "Break a Raft cluster", whose letters b, a and k come in order.

The site's other rules still hold. The menu opens on ⌘K or Ctrl+K, never on a bare key: syntaqx's `/` is a character-key shortcut, which SC 2.1.4 allows only with a way to turn it off. Every row still exists elsewhere on the page.

### A row is its link

**A row of an index opens its page wherever it is pressed**: a card on Home, a post in a list, a demo on `/lab/`.

- **The pattern is the stretched link**: the row's one link draws an empty `::before` with `position: absolute; inset: 0` over its row. That makes the whole row the link's hit area, with native link behaviour: middle-click, ⌘-click, the status bar's address and the context menu. On paper it does nothing, since the print rules print each link's address after it on `::after`.
- **Which link stretches.** For a post or a demo it is the title's link. For a card it is its "Try it" link, whose name now adds the card's title ("Try it: Break a Raft cluster"). So a list of the page's links says where each goes (SC 2.4.4). The name starts with the visible words, so it still holds its label (SC 2.5.3).
- **The rise moved.** A post's and a demo's title used to rise on its `<h2>`, with `clip-path`, which would clip the link's box to the title. The rise now moves a span of the title's words inside the link.
- **The row's marks.** Hovered or focused, the 2 px bar sweeps the row's rule, now on post rows too. Hovered, the card's title takes the accent, and the arrow after "Try it" steps toward its target. The focus ring stays on the link itself, as on every element (SC 2.4.7).

### The drawing ends with the page

The page's drawing is `min(56.25rem, 100%)` of the body's height (36rem on a phone), so it never makes the page taller than its content.

## Alternatives considered

| Option | Trades | Door |
|---|---|---|
| **A. Rail as an index; the command menu as search; stretched links (chosen)** | Every demo one press from any page. One search tool. Native link behaviour on the whole row. A row's words cannot be selected by dragging. | Two-way |
| B. A full-text search library (Pagefind) in the rail | Real full-text search over every page, built at build time and static. But by Pagefind's own figure a search on most sites loads about 100 kB, the library included, against the menu's 149 B. It also adds a second search UI beside the menu, for a site with two demos and one post. | Two-way |
| C. Wrap each row in one `<a>` | No CSS trick. But the link's name becomes the whole row (date, kind, title and summary read as one link), and a heading inside a link reads poorly in a screen reader's lists. | Two-way |
| D. A click handler on the row that forwards to its link | Text stays selectable. But it needs JavaScript on every list page, it is not a link to the browser (no middle-click, status bar or context menu), and it does nothing without the script. | Two-way |
| E. Keep the rail to its sections; list the demos only on `/lab/` | Nothing new to maintain; a demo stays two presses away, which is what Joseph asked to change. | Two-way |

## Prior art

Read on 2026-10-29:
- **syntaqx.com** (Joseph's reference). A top bar, with a search field that opens a command menu. Posts and tools are rows and cards, each one link across its whole width (1,232 px for a post row). Each section has an "all posts →" link. The footer is a sitemap in columns.
- **brittanychiang.com.** The best-known sidebar portfolio, already ADR 0021's reference. Each experience card highlights whole under the pointer, and its heading link stretches over it through an absolutely positioned span.
- **taniarascia.com.** A sidebar personal site: name and theme toggle on top, a short line about her, nav items with icons, and icon links at its foot. Every post row and every card is one link across the content's width.
- **leerob.com.** A one-column site with no sidebar. Its notes and posts are plain link lists.
- **Docs sidebars** (Astro Starlight, Docusaurus): a section's pages listed under it, the current one marked, and a search field above that opens a command menu.

Further reading:
- **The pattern:** Heydon Pickering, "Cards", in *Inclusive Components* (2019), on the pseudo-element link versus the wrapping link, and the selection trade.
- **Bootstrap** ships the same pattern as `.stretched-link`.

## Consequences

- **Bytes, gzip -9, against production on 2026-10-29.** The command menu's script is 1,562 → 1,711 B. HTML is about +240 to +310 B a page (the leaves and the menu's two groups). The stylesheet is 8,230 → 8,760 B. All within budget (`test/budgets.test.ts`).
- **Tab order.** On `/lab/` at 1440 px, Tab passes 3 more stops before main (the search field and the two demos), and one more for each post the rail lists. The order is the reading order, top to bottom (`e2e/living-ground.spec.ts`).
- **A row's words cannot be selected by dragging across them**, the trade every whole-row link makes. The page a row opens holds the same words, selectable.
- **One more fixed number**, `RAIL_POSTS = 3`, the posts the rail lists. It matches Home's Writing row.
- **Tests.**
  - `e2e/index.spec.ts`: a press on a row's padding opens its page; the rail lists every demo and marks the one on screen; no page scrolls past its own end. Against production it fails on all three, for the reasons Joseph reported.
  - `test/nav.test.ts`: `railLeaves`.
  - `test/palette.test.ts`: `contains` and the new groups.
  - `test/writing.test.ts`: the rail's three newest posts, on the five-post fixture.

## Door

Two-way. The leaves, the search field and the foot's words are rail-only markup and CSS: removing them gives back ADR 0021's rail. The stretched link is one CSS rule and a span. The drawing's cap is one value.

## Revisit if

- **The lab passes about eight demos**, when the rail's list would push About below the fold of a 900 px window. Then give the lab schema a `published` day (each entry re-stamped), list the newest five, and add "All N demos".
- **The site passes about 30 pages**, or a visitor needs a word from inside a post. Then full-text search (option B) earns its bytes, and the command menu's search field opens it.
- **Joseph or a visitor reports reaching for a row's words** to copy them. Then option D, a forwarding handler that keeps selection, is the fix.
