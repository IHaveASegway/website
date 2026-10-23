# ADR 0005: URL scheme with trailing slashes

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

A URL is the one part of the site that other people store. Once it is in a résumé, a LinkedIn post, a Slack unfurl, a search index, a feed reader or the Wayback Machine, it lives outside the site's control. Changing it later costs a redirect kept forever, and some copies never catch up: a feed reader that stored the old URL as an item's ID shows the moved post again as new.

Nothing is published yet, so today every URL choice is free. Once PR 2 deploys the first real Home and Joseph shares a link, it is not.

Three layers must agree on every URL, or one page gets two addresses:

| Layer | Setting | What it controls |
|---|---|---|
| Astro | `trailingSlash`, `build.format` | how pages are written to `dist/`, `Astro.url`, link helpers, dev-server matching |
| Workers static assets | `assets.html_handling` | what a request for `/about` or `/about/` gets in production |
| Canonical tags, sitemap, feed | `site` and the templates | which form search engines and feed readers store |

Astro's configuration reference says that for prerendered pages the hosting platform handles trailing slashes, and that dev and build stay consistent when `trailingSlash: 'always'` is paired with `build.format: 'directory'`, or `'never'` with `'file'` ([Astro configuration reference](https://docs.astro.build/en/reference/configuration-reference/), as of 2026-10-22). Google says it treats `/about` and `/about/` as separate URLs ("Google treats each URL above separately (and equally)") and recommends that one redirect to the other ([To slash or not to slash](https://developers.google.com/search/blog/2010/04/to-slash-or-not-to-slash), 2010).

## Decision

**The scheme.**

| Pattern | Page |
|---|---|
| `/` | Home |
| `/work/` · `/work/<slug>/` | Case studies |
| `/lab/` · `/lab/<slug>/` | Demo write-ups, static pages |
| `/lab/api/*` | The lab Worker's API: dynamic, not pages ([ADR 0009](0009-lab-worker-same-origin.md)). Reserved: no page slug under `/lab/` may be `api` |
| `/writing/` · `/writing/<slug>/` | Essays |
| `/notes/` · `/notes/<slug>/` | Field notes |
| `/about/` · `/now/` · `/colophon/` | Single pages |
| `/colophon/decisions/` · `/colophon/decisions/<nnnn-slug>/` | Published ADRs; the slug is the file name in `docs/adr/` |
| `/privacy/` | Ships before the first lab ([security.md](../security.md)) |
| `/resume/` | Later, pending the firewall questions; its PDF is `/resume/joseph-peterson-resume.pdf` ([content.md](../content.md)) |
| `/rss.xml` · `/sitemap-index.xml` · `/robots.txt` · `/.well-known/security.txt` · `/favicon.ico` · `/favicon.svg` · `/apple-touch-icon.png` | Files. They keep their extensions because clients ask for them by name; `robots.txt`, `security.txt`, `favicon.ico` and `apple-touch-icon.png` also sit at the paths clients look in by convention |
| `/404` | The not-found page, served with status 404 for any unknown path (`not_found_handling: "404-page"`). Workers also serves it at `/404` itself with status 200, a soft 404, so the page carries `noindex` and stays out of the sitemap |

**Trailing slash, always.** Every page URL ends in `/`.

- Astro: `trailingSlash: 'always'` and `build.format: 'directory'`, so every page is written as `<path>/index.html`.
- Workers: `assets.html_handling: "auto-trailing-slash"`, the default. With directory output it serves `/about/` and answers `/about` with a 307 to `/about/` ([HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/), as of 2026-10-22).
- Canonical tags, `og:url`, the sitemap and the feed use the slash form. Every internal link ends in `/`.

**Slugs.** A slug is the content file's name: lowercase ASCII words joined by hyphens. No dates. No file extensions. No words about how the page is made (a framework, `index`, `html`) and no status words (`new`, `draft`, `final`, `v2`). Most of this follows Berners-Lee's list of what to leave out of a URI: author's name, subject, status, access, file name extension, software mechanisms, disk name. Where the scheme departs from it (subject-like section prefixes, no dates), the Alternatives and Consequences below say why. His reason is the rule this record exists for: "URIs don't change: people change them."

**Slugs never change.** A rename adds a 301 to `apps/web/public/_redirects`. The file allows 2,000 static and 100 dynamic redirects of up to 1,000 characters each, and its default status is 302, so every rule states 301 ([Redirects](https://developers.cloudflare.com/workers/static-assets/redirects/), as of 2026-10-22). Every page URL that has been deployed is listed in `apps/web/published-urls.txt`, an append-only ledger beside the site. `verify` fails when a built page is missing from the ledger, or when a URL in it is neither a built page nor the source of a 301. The ledger lives in the repository because `verify` has no network, so production's sitemap is out of its reach. ADR file names are part of the scheme: renaming an ADR file is a URL change.

**Nothing moves between sections.** A note that grows into an essay is published as a new essay that links back; the note keeps its URL.

**Sections appear when they have content.** A reserved prefix with nothing in it builds nothing and is not linked from the header. Writing renders only once at least 3 posts exist. Every prefix of a page URL is itself a page, so `/work/gitops/` trimmed to `/work/` lands on the index; `/lab/api/` is the exception.

**Feeds.** Each RSS item's `guid` is its canonical URL. Because URLs do not change, feed readers never see an old post as new.

## Alternatives considered

- **`/blog/` instead of `/writing/`.** For: it is the path people guess, and the framework research for this plan proposed it. Against: "blog" names a format, and the site keeps essays (`/writing/`) apart from field notes (`/notes/`); the path should match the nav label, so a visitor who reads "Writing" can predict the URL. It gives up a little usability (the guessable path) for evolvability (no format word in a permanent URL). The stakes are low today. If guessers turn out to matter, one dynamic rule, `/blog/* /writing/:splat 301`, costs 1 of the 100 dynamic redirects.
- **Dated URLs** (`/writing/2026/11/<slug>/`). For: the canonical source recommends them. Berners-Lee: "The creation date of the document - the date the URI is issued - is one thing which will not change", and "That is one thing with which it is good to start a URI." A date also makes a slug unique without a registry and shows a post's age. Simon Willison (`simonwillison.net/2022/Nov/6/what-to-blog-about/`) and Julia Evans (`jvns.ca/blog/2023/06/05/some-blogging-myths/`) date their URLs. Against: longer URLs in résumés and slides; case studies and notes are living pages, updated after publication, so a date in the path misleads; a date in an unfurl makes evergreen material look stale; and uniqueness is cheap here anyway (one folder per section, one file per slug). Will Larson (`lethain.com/being-visible/`) and Dan Luu (`danluu.com/web-bloat/`) publish undated URLs. The trade: uniqueness and an honest age, against usability and evolvability. This is a deliberate departure from the source the rest of the scheme follows, and it is written down for that reason.
- **No trailing slash** (`/about`). For: shorter, and the default of many frameworks. Against: it needs `trailingSlash: 'never'` and `build.format: 'file'`, two settings moved from Astro's defaults where "always" moves one (`trailingSlash`); Workers' default `auto-trailing-slash` then serves `about.html` at `/about`. Relative links also resolve one level up: a page at `/work/stillhere` that references `diagram.svg` gets `/work/diagram.svg`, so a page cannot keep its assets beside it. Either form works if it is consistent; "always" sits closer to the defaults (operability) and keeps relative links predictable (evolvability).
- **Serve both** (`trailingSlash: 'ignore'`, Astro's default). Every page gets two addresses, inbound links split between them, and canonical tags have to paper over it. It gives up consistency (one page, one address) to save one line of configuration. Rejected.

Prior art: Cloudflare's developer documentation, Astro on Workers like this site, uses trailing-slash URLs and answers `https://developers.cloudflare.com/workers` with a 307 to `/workers/` (checked 2026-10-22). GOV.UK's publishing guidance asks that URLs "be in lower case" and "use dashes to separate words within the URL" ([GOV.UK URL standards](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/follow-url-standards/)).

Patterns: cool URIs (Berners-Lee, ["Cool URIs don't change"](https://www.w3.org/Provider/Style/URI), 1998), hackable URLs (Nielsen, ["URL as UI"](https://www.nngroup.com/articles/url-as-ui/), 1999), canonical URLs. Sources: [reading-list.md](../reading-list.md).

## Consequences

- A visitor who types `/about` takes one 307 hop to `/about/`. Google's post recommends a 301 from the duplicate to the preferred form, and Workers sends a temporary 307 instead. That is acceptable: for redirects to trailing-slash URLs the same post says "our search results will likely show the version of the URL with the 200 response code", "regardless of whether the redirect was a 301 or 302", and the canonical tag names the slash form anyway.
- A build test crawls `dist/` and fails on an internal link without a trailing slash, or a page URL with a date, an extension or an uppercase letter. A second check reads the ledger of published URLs and fails when one leaves without a 301. It needs no network and no production, so it runs from the first pull request. A smoke test asks for each page's other form, `/index.html` for Home and the slashless form of every other page, and expects a redirect to the slash form. All three are fitness functions: the scheme is tested on every pull request, not remembered ([delivery.md](../delivery.md)).
- The ledger is append-only by review, not by test. A pull request that deletes a page and its ledger line together passes CI, so review reads every removed line of `published-urls.txt`.
- Every rename shows up in review as a line in `_redirects`, and the line stays. Deleting a redirect breaks the old links it protects.
- A rendered ADR's file name is a public URL, so the naming rule in [ADR 0001](0001-record-architecture-decisions.md) doubles as a URL rule.
- `/lab/api/*` is the only path that runs code. Everything else is a static asset, which keeps page views out of Worker quotas and bills ([ADR 0002](0002-host-on-workers-static-assets.md), [ADR 0009](0009-lab-worker-same-origin.md)).
- Section prefixes classify pages by type, close to the "subject" Berners-Lee warns against putting in a URI. The types here are coarse and stable (a case study does not become an essay), and the no-move rule keeps a reclassification from breaking a URL.

## Door

Nearly one-way. It is free to change until the first URL is shared, which happens when PR 2 deploys the first real Home. After that a slug change costs a 301 kept forever, and changing the trailing-slash policy costs a site-wide redirect and weeks of mixed signals in search. Redirects recover most of a URL's value but not all of it: feed readers and some preview caches keep the old form.

## Revisit if

- Redirects pile up. More than about 10 in the first year means slugs are chosen too early: choose a slug at publish time, not at draft time.
- A new kind of content needs a home (talks, for example). Add a prefix by amending this record; never reuse an existing one.
- Search Console reports slashless duplicates of pages. Then the three layers disagree somewhere.
- A list page passes about 50 entries and needs pagination, or tags get pages of their own (with search, at about 20 posts). Decide those URL forms here before building them.

## Postscript 2026-10-23

`/work/` and `/work/<slug>/` are unused: owned work became cards on Home that link to their repositories ([content.md](../content.md#owned-work)). The prefix stays reserved, so case studies could return without an amendment. Nothing else changes, and no Revisit if condition was met.
