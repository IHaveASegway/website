# ihaveasegway.com: product brief

This brief says why ihaveasegway.com exists, who it serves, what it must never contain, what is still undecided, and how we will know it works. The other docs say how the site is built, shipped and run; this one says what all of that is for, and every other doc should trace back to something here.

Status: Draft for review in PR 1 · 2026-10-22

Index: [README.md](README.md) · Decisions: [adr/](adr/README.md) · System: [architecture.md](architecture.md) · Plan: [roadmap.md](roadmap.md)

## In one line

Joseph Peterson's personal site: name, title, proof and contact inside a 7-second scan for recruiters, then the decisions behind the work for engineers who want to check the depth, built so that the site is itself evidence of how he builds.

## Why

**Who needs it.** Joseph is a senior backend and platform engineer, training to become a software architect. Two kinds of visitor need something a LinkedIn profile and a résumé cannot give them:

1. Recruiters, who need his name, title, one proof point and a way to reach him inside a scan of about 7 seconds.
2. Hiring managers and engineers for senior and architect roles, who need depth: owned work they can check in its repository, the decisions behind it (ADRs), demos, and writing.

**Where they come from.** Mostly from links Joseph hands out: the résumé, LinkedIn, GitHub, and posts shared in Slack and on LinkedIn. Not from name search: "Joseph Peterson" is a crowded name. The site's job is to convert those links. It is not an SEO project.

**The problem.** His strongest professional work cannot be shown. The [content firewall](#content-firewall) keeps his current employer and his private venture off the site entirely, so depth has to come from work he owns (stillhere, gitops, and this site) and from writing. LinkedIn has room for neither.

**If nothing is done.** Recruiters see a LinkedIn profile and a résumé. Nothing shows how he decides: no trade-off he weighed, no design he can point to. The domain, registered and paid for, keeps serving nothing.

**What it is not.** A product with users, a showcase of effects, or a job board. The full list is under [Non-goals](#non-goals-v1).

## Who it serves

**Primary: the person who just clicked a link Joseph handed out.** The first screen answers the recruiter. Everything below it answers the engineer.

| Who | What they need | Time they give it | What answers it |
|---|---|---|---|
| Recruiter | Name, title, one proof point, how to reach him | About 7 seconds, mostly on the first screen | Home rows 1–3, visible without scrolling at 390×844 and 1440×900: hero, status line, at a glance ([content.md](content.md)) |
| Hiring manager, senior or architect role | Evidence of judgment: the problem, the options, the decision, the result | Minutes, usually after a recruiter's screen | Project cards on Home that link to the repositories, whose READMEs and ADRs show the problem, the options and the decision; essays; "How I work" on Home |
| Engineer evaluating his work | Something to check: source, decisions, a demo that works or says why it does not | As long as the material holds them | Public repos, selected ADRs rendered at `/colophon/decisions/<nnnn-slug>/` ([ADR 0001](adr/0001-record-architecture-decisions.md)), `/writing/` and `/notes/`, the lab (Phase 4) |
| Joseph | A place to practice architecture under real constraints, material for conversations about his work, a writing habit | ≤2 h/month of upkeep plus 8–10 h/month of writing (Q23) | This repository: docs/, the ADRs, the pipeline, `/now/` |

**The evidence.** The 7-second budget comes from recruiters' résumé scans: 6 s in Ladders' [2012 eye-tracking study](https://www.bu.edu/com/files/2018/10/TheLadders-EyeTracking-StudyC2.pdf), 7.4 s in its [2018 follow-up](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/). [content.md](content.md#who-reads-and-how-fast) owns the reading-time studies and turns them into the order of Home's sections; the findings below bear on what the site is for. Most of these studies are vendor-run or dated: they set direction, and the 7-second test under [How we will know it works](#how-we-will-know-it-works) checks them against this site.

| Finding | Number | Source | What it changes here |
|---|---|---|---|
| Photos | 19% of recruiters' time on LinkedIn profiles went to the profile picture (30 recruiters, 10 weeks) | Ladders, 2012 (above) | No photo in the hero (Q20) |
| What hiring managers weigh | 9 in 10 rank previous experience and years of experience among the top qualifications; portfolios count for more at small companies (80%) than at large ones (66%) | [HackerRank 2018](https://www.hackerrank.com/research/developer-skills/2018/) (39,441 developers, 7,000+ employers) | Lead with proof of experience, not a list of technologies |
| Employers look candidates up | 53% used social sites to research candidates; 35% were less likely to interview someone they could not find online | CareerBuilder and Harris Poll, 2015 (2,000+ hiring and HR managers), via [SHRM](https://www.shrm.org/topics-tools/news/technology/lack-social-media-presence-can-hurt-job-seekers) | Be easy to find from the links; ranking for the name is not the goal |
| The usual accessibility failure | Low-contrast text on 83.9% of the top million home pages | [WebAIM Million 2026](https://webaim.org/projects/million/) | The "cyber" look must not become neon text on black |
| Visibility at staff-plus level | "There are a huge number of successful Staff-plus engineers with no external presence" | Will Larson, ["Being visible"](https://lethain.com/being-visible/) (2020) | The site helps but is not required, so its upkeep must stay small |

## The ask and the need

**The ask**, as it reached this plan, led with the platform: a personal site on Cloudflare, with Durable Objects demos, a "cyber" feel, and maybe a blog.

**The need** is evidence plus a writing habit. The ask names the right destination and starts from the wrong end:

- **It starts from technology.** Cloudflare and Durable Objects (DOs) are sound choices ([ADR 0002](adr/0002-host-on-workers-static-assets.md), [ADR 0009](adr/0009-lab-worker-same-origin.md)), but they answer "how" before anyone answered "for whom" or "what must it never say".
- **Demos come after content.** They are the differentiator, but an unexplained or broken demo is worse than none. Each one needs a write-up, a cost line and a recorded fallback, so the lab is Phase 4.
- **"Cyber" is a look; the need is a page that reads in 7 seconds.** Principle 6 turns the look into Joseph's work and keyboard navigation.
- **"Maybe a blog" is a liability without a cadence.** An empty or stale Writing section signals abandonment, so Writing renders only once a post is published ([content.md](content.md) owns the number: 1, proposed on 2026-10-24 for Joseph's read, from his ask for a workable site from the content he has), with a stop rule (Q23).
- **The ask is silent on the firewall**, which turned out to shape every page.

**The three questions that should have come first:**

| Question | Why it comes first | What its answer sets | Where it is tracked |
|---|---|---|---|
| (a) What is the firewall protecting against? | It decides what can be said at all, and every page is made of things said | The LinkedIn link, the availability line, the résumé edition, which demos may exist | Q3, then Q5, Q6, Q8, Q9, Q13 |
| (b) Where do visitors come from? | It decides what the site optimizes for | Links, not search: a landing page that answers in 7 seconds and unfurls well in Slack and LinkedIn (Open Graph images), not keyword work | Answered in [Why](#why); checked against referrers after 90 days |
| (c) What does "manageable alone" mean, in hours per month? | Every component carries upkeep, and without a number scope only grows | ≤2 h/month of maintenance plus 8–10 h/month of writing; one PR in flight; no infrastructure as code until a trigger fires | Q23; [roadmap.md](roadmap.md); [How we will know it works](#how-we-will-know-it-works) |

A weaker start would have asked "what can I build on Durable Objects?" and produced an impressive demo with nothing around it to explain it, on a page a recruiter leaves after 7 seconds.

## What exists, and what is new

Nothing is deployed. As found on 2026-10-22:

| Asset | State on 2026-10-22 | What this plan does with it |
|---|---|---|
| Domain `ihaveasegway.com` | Cloudflare Registrar; auto-renew on; registrar lock on; WHOIS redaction on, but the public RDAP record still shows the registrant's state ([security.md](security.md#zone-hardening-checklist)); expires 2027-10-18 | Keep it. Optionally extend before the 2026-11-01 price rise (Q14) |
| Cloudflare zone | Free plan; 0 DNS records; DNSSEC, Always Use HTTPS and HSTS off; minimum TLS 1.0 (read through the API, read-only). The full state as found is in [security.md](security.md) | Hardened in PR 2 ([ADR 0011](adr/0011-dnssec-and-hsts-ramp.md)) |
| A site | None: the domain serves nothing | PR 2 deploys a minimal real Home |
| Cloudflare account | Already runs one other Worker. The Free plan's daily Worker request quota is per account, so the two share it | Spikes that could spend that quota ask Joseph first ([roadmap.md](roadmap.md)) |
| This repository | One initial commit. Private, on a GitHub Free personal account, where rulesets and branch protection are unavailable (the API returns 403) and environments are public-repo-only ([GitHub plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)) | docs/ in PR 1; the pipeline itself is the gate ([ADR 0006](adr/0006-github-actions-owns-deploys.md)); public after the audit ([ADR 0012](adr/0012-public-repository.md), Q7) |
| stillhere | Joseph's own. Public; Apache-2.0; pre-release; 15 ADRs; publishes a failed validation of its own headline metric | A card on Home that links to its repository, turned on in PR 4 after the readiness checks (Joseph, 2026-10-23: card → repo only) |
| gitops | Joseph's own, with outside contributions. MIT; cosign-signed checksums; CI on Linux, macOS and Windows. Its last public release, v1.2.2, came out on 2026-10-23, and Joseph made the repository private the same day | Held off the site ([content.md](content.md#names-held-off-the-site)) until it is public again; then a card like stillhere's (Joseph, 2026-10-23) |
| capacitor | Someone else's project, with an upstream contribution from Joseph | One contribution line, never "his project" |
| Mission-AI console UI | His own earlier project; private | Design lineage only. The token file began as a copy of its shadcn token names and zinc neutrals, which Joseph confirmed are his (Q25); direction C replaced the neutrals and the accent on 2026-10-23, and the copied structure stays ([ADR 0010](adr/0010-quiet-console-design-tokens.md)). No Mission-AI content at launch (Q24) |
| Employment history | LinkedIn and his private résumé | Stays there and is never copied into the repository ([ADR 0004](adr/0004-content-as-code.md)) |
| Older private repos | Private | Stay private and unlinked (Q22) |

The owned-work facts were read from the repositories on 2026-10-22. This brief names the repositories but does not link them: a repository gets a link from the site only after it passes the readiness checks in [content.md](content.md#repo-readiness-checklist), a firewall scan of its tree, history and PR text plus a commit-identity check.

**What is new:** the site; its content (essays, field notes, rendered ADRs, cards for owned work); a delivery pipeline in which nothing deploys unless the content firewall passes; and, in Phase 4, the lab.

## Prior art

What already solves "a portfolio site", and what each option gets right:

| Approach | Examples | What it gets right | Why not here |
|---|---|---|---|
| Hosted portfolio and profile builders | Squarespace, Wix, Webflow, Carrd; profile sites such as Read.cv | Live in an hour; no upkeep | No architecture signal: the one thing an architect's site should show is how it is built. Lock-in: the content, the URLs and the analytics live in someone else's system of record. And hosted services vanish. Read.cv began winding down the day its acquisition was announced, 2025-01-17, with exports open until May 16 ([TechCrunch](https://techcrunch.com/2025/01/17/perplexity-acquires-read-cv-a-social-media-platform-for-professionals/)). Hosted PartyKit, the managed form of the room layer the lab uses, stops on 2026-10-23 and deletes the projects and room data still on it ([PartyKit](https://blog.partykit.io/posts/hosted-platform-shutdown)), so the lab runs PartyServer in Joseph's own account ([lab.md](lab.md)) |
| Hosted writing platforms | Medium, Substack, dev.to | An audience and distribution | The same lock-in, and the canonical URL is theirs. No room for case studies, ADRs or demos. Use them for reach instead: publish here first, then syndicate (POSSE) |
| A static site generator plus a static host | Hugo, Jekyll, Eleventy or Astro, on GitHub Pages, Netlify, Vercel or Cloudflare; templates such as Brittany Chiang's v4 | Cheap, fast, portable; Markdown in git | Nothing: this is the category this plan picks ([ADR 0002](adr/0002-host-on-workers-static-assets.md), [ADR 0003](adr/0003-astro-static-first.md)). What it avoids is the most-copied template, which reads as a template ([design-system.md](design-system.md)) |

**A company with the same problem.** Cloudflare's developer documentation is the same shape at a far larger scale: Astro, built in GitHub Actions, a Worker Preview for every pull request. [architecture.md](architecture.md) covers what this plan copies from it. One difference is worth knowing: its [package.json](https://github.com/cloudflare/cloudflare-docs/blob/production/package.json) also carries the Astro Cloudflare adapter (astro 7.4.1 and @astrojs/cloudflare 14.4.1, as of 2026-10-22), which a fully static site does not need, so this one goes without it ([ADR 0003](adr/0003-astro-static-first.md)).

**Engineers' own sites.** Six worth studying, and what this plan takes from each:

| Site | What it teaches | What this plan takes |
|---|---|---|
| Julia Evans, [jvns.ca](https://jvns.ca/) | Short posts on one thing she just learned ([Some blogging myths](https://jvns.ca/blog/2023/06/05/some-blogging-myths/), 2023); one page lists "every post I've ever written, organized by category" | Field notes at `/notes/` as a first-class type; one archive page by category |
| Dan Luu, [danluu.com](https://danluu.com/) | Plain HTML and a list of posts; the words carry the design. His own [web-bloat](https://danluu.com/web-bloat/) table lists the site at 0.03 MB | A page-weight budget (Home ≤150 KB transferred) |
| Simon Willison, [simonwillison.net](https://simonwillison.net/) | Notes that take minutes, beside long posts; "write about it" as part of "done" ([What to blog about](https://simonwillison.net/2022/Nov/6/what-to-blog-about/), 2022) | "Write about it" in this project's definition of done ([content.md](content.md)) |
| Josh W. Comeau, [joshwcomeau.com](https://www.joshwcomeau.com/) | Delight with off switches ("Disable sounds", "Activate dark mode"); a post on [how the blog is built](https://www.joshwcomeau.com/blog/how-i-built-my-blog-v2/) | Every effect can be turned off or respects reduced motion; `/colophon/` |
| Bartosz Ciechanowski, [ciechanow.ski](https://ciechanow.ski/) | Long essays in which the interactive parts are the explanation | A lab demo explains one idea and ships with its write-up |
| Will Larson, [lethain.com](https://lethain.com/) | Curated ways in (popular posts, tags, RSS); writing as long-lived documents ([Being visible](https://lethain.com/being-visible/), 2020) | Selected work on Home; the ADRs as the long-lived documents |

**Why build anyway.** If the only goal were the 7-second scan, a hosted builder and a LinkedIn link would do. The second goal decides it: for a senior or architect role, the site is itself evidence of how Joseph builds. A builder shows taste in templates. This site shows a system: content as code, pages that run no code, a deploy that waits for a content check, decisions written down with their doors and revisit triggers, and a cost model with a $0 ceiling.

It is composed, not invented. Astro builds the pages; an assets-only Worker serves them; GitHub Actions gates and deploys them; gitleaks runs the firewall rules; Cloudflare Web Analytics counts visits; Email Routing receives mail. Bespoke code is limited to glue: the firewall check (about 80 lines of shell), a zone audit script, and a few small vanilla modules for effects ([stack.md](stack.md)). The weaker design in either direction: fully hosted, which trades evolvability and control for time to launch and leaves someone else holding the off switch; or fully bespoke (a home-made generator or deploy system), which trades operability for months of upkeep that prove nothing a reviewer cares about.

The door is two-way. Content is Markdown and the output is static files, so moving to a hosted builder would take days. It becomes the right move if maintenance runs over 2 h a month for three months running ([How we will know it works](#how-we-will-know-it-works)).

## Principles

1. **Content first; effects second.** The site exists to be read: in 7 seconds, then in depth. An effect ships only if it costs no reading time and degrades to nothing, and content PRs come before effects and before the lab.
2. **Static by default. Code runs at the edge only where a visitor's input matters (bulkhead).** Pages are prebuilt files served by an assets-only Worker. Requests to static assets are free and unlimited, and only requests that hit a Worker count against the Free plan's 100,000 a day (as of 2026-10-22, [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). Code lives behind `/lab/api/*` in a separate Worker, so a demo that fails or uses up the quota cannot take the portfolio down ([ADR 0002](adr/0002-host-on-workers-static-assets.md), [ADR 0009](adr/0009-lab-worker-same-origin.md)). That assets keep serving after the daily cap is implied by the docs, not stated; spike S1 tests it.
3. **One owner per piece of data.** Every fact has one system of record: the repository for site content, LinkedIn for employment history, GitHub for release facts, which the build reads. Copies drift; a link or a build-time snapshot does not ([ADR 0004](adr/0004-content-as-code.md), [architecture.md](architecture.md)).
4. **Every number has a unit and a source.** "Fast" is not a claim; "LCP 1.5 s at p75 on mobile" is. Prices, limits and versions carry an "as of" date and a source URL, in these docs and on the site.
5. **Fail closed, on cost (Free plan) and on content (firewall).** On Workers Free, usage past a limit fails instead of billing: past 100,000 requests a day a Worker returns Error 1027 ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), as of 2026-10-22). The firewall check fails the deploy when it finds something, and also when it cannot prove the content clean, for example when its rules did not load ([ADR 0007](adr/0007-content-firewall.md), [ADR 0008](adr/0008-workers-free-with-guardrails.md)). This is the fail-safe default: when in doubt, nothing ships and nothing is billed.
6. **The site shows Joseph's work, never its own engineering; keyboard-first navigation; no decoration that delays reading.** Since 2026-10-26, interactive 3D is allowed where it shows the work, loaded on intent over a picture that stands without it ([ADR 0019](adr/0019-space-time-cube-in-webgl.md)); 3D that only decorates is still out. Since 2026-10-29 a scene that shows the work may run on Home after the first paint, over a picture that stands without it, small, and paused on request: the Route Lab's day, driven on the map and lifted into its space-time cube as the page scrolls ([ADR 0024](adr/0024-home-led-by-the-work.md), which replaced ADR 0021's moving contour drawing). "There is a difference between demonstrating and executing" (Joseph, 2026-10-24): no page shows a build SHA, a build date, the data center that served it or a figure about its own bytes, and no page draws its own grid or numbers its own sections. Machines check those instead: CI enforces the budgets, and the deploy smoke reads the commit from a response header no page holds ([design-system.md](design-system.md#nothing-on-the-page-describes-the-site)). ⌘K opens a command palette. No glitch loops, no sound, nothing that flashes more than 3 times a second, and nothing between the visitor and the first line of text; anything that updates on its own can be paused ([design-system.md](design-system.md), [ADR 0010](adr/0010-quiet-console-design-tokens.md)).
7. **Two-way doors decided fast; one-way doors written down (ADR).** Layout, styling and section order change in a PR. URLs once shared, anything published, and the repository's visibility are hard or impossible to undo, so each gets an ADR with a Door and a Revisit if.
8. **One pipeline, one writer per environment.** GitHub Actions is the only thing that deploys production. If Workers Builds is ever connected, the Actions deploy job is deleted in the same PR ([ADR 0006](adr/0006-github-actions-owns-deploys.md)). Two deployers for one environment is the delivery version of two owners for one fact.

## Content firewall

This section is the **policy**: what is excluded and why. How it is enforced (the check, its rules, its exit codes, its hooks) is in [security.md](security.md) and [ADR 0007](adr/0007-content-firewall.md).

**The rule (Joseph's):** nothing about his current employer or his private venture appears on the site, in the repository, or in commit metadata.

**What is excluded:**

- Names: of either company, and of their brands, products, domains, email domains and GitHub organizations.
- Internal system names and internal repository names.
- Colleagues' names and handles.
- Internal metrics, including every number on his résumé that comes from employer work. Résumé metrics are not published until cleared.
- Identifying details: industry-specific words that narrow to one company, the city he lives in, coordinates, and descriptions of employer systems even without names.

**Where it applies:** pages and built output, including images, Open Graph images and PDFs; the repository's tree and history; commit and PR metadata (titles, bodies, branch names, author and committer identities); these docs; and every repository the site links, which passes the same scan and an identity check before the link ships.

**Why:**

- **It is Joseph's rule.** The plan does not trade it against anything.
- **The mosaic effect.** "The mosaic effect occurs when the information in an individual dataset, in isolation, may not pose a risk of identifying an individual ... but when combined with other available information, could pose such risk" ([OMB M-13-13](https://obamawhitehouse.archives.gov/sites/default/files/omb/memoranda/2013/m-13-13.pdf), 2013). An industry noun, a city, a rare job title and a LinkedIn link are each harmless; together they name one company. So anonymizing a case study is not enough, which is why employer case studies are a non-goal rather than a redaction exercise.
- **Publication is a one-way door.** Web archives, link-preview caches, clones, forks and package proxies keep what was published. Rewriting history afterwards does not reach them.
- **Confidentiality and ownership.** Employer systems, and anything that could be an employment invention, are not his to publish (Q13).

**What is allowed:** role titles without a company or city; facts about work he owns; the generic phrases "current employer" and "private venture". Mission-AI, his own earlier project, may be referenced later, by his decision; it is not on the site at launch (Q24).

**Default:** each piece of copy takes the strictest class that could apply. [content.md](content.md) sorts draft copy into SAFE, ASK and NEVER, and an ASK item becomes SAFE only when Joseph clears it in writing. What the firewall protects against is still open (Q3). Until Joseph answers, these docs assume the recommended "not described": no names and no descriptions of employer systems or metrics, with a LinkedIn link allowed. If he picks the stricter "not traceable", links to anything that names the employer come out: LinkedIn first, and the GitHub profile too if its bio, company field or README names the employer ([content.md](content.md#repo-readiness-checklist)).

**Never committed:** the list of terms the check looks for. It lives outside the repository, and no doc quotes it, because a committed list would publish exactly what it protects. PR 1's docs are scanned locally before commit; from PR 2, CI scans every pull request and every deploy depends on that scan.

**Where sensitive answers live.** Answers and clearances that name something the firewall protects (a place, the exact wording of a title or an industry noun, an ASK clearance, availability intent, the outcome of the IP check in Q13) are written in a private record outside GitHub, kept beside the rules file ([security.md](security.md#content-firewall-design)), never in a pull request, review, comment, issue or commit. GitHub keeps every review and comment with its edit history, and the switch in [ADR 0012](adr/0012-public-repository.md) publishes them all. The repository records only the option chosen and what ships.

## Milestones

A summary of [roadmap.md](roadmap.md), which owns scope, definitions of done and the spikes. Estimates are in focused days. One PR is in flight at a time; on 2026-10-23 that limit was relaxed for a branch stacked on PR 3's and for the lab's spikes, and the order changed ([roadmap.md](roadmap.md#how-we-work)).

| Phase | PR | Ships | Est. (days) | Blocked by |
|---|---|---|---|---|
| 0 | PR 1 | docs/ (this PR) | done | — |
| 1 | PR 2 Foundation | pnpm workspace; Astro static site; tokens, base layout, 404; CI (verify, firewall, preview, e2e, deploy, prod-smoke); local hooks; Dependabot; security headers; zone hardening; a minimal real Home on `ihaveasegway.com` | 2–3 | — (spikes S7 and S8 run inside it) |
| 2 | PR 3 Home v1 | Direction C's typefaces, tokens and components; the theme toggle; final Home copy; Open Graph images; JSON-LD; budgets enforced in CI | 2–3, re-baselined to about 7 | The design exploration |
| 3 | PR 5 Writing, next | `/writing/`, `/notes/`, `/rss.xml`; first posts (Writing renders at ≥3) | 2 | — |
| 2 | PR 3b Colophon, analytics, LHCI | `/colophon/` with the ADRs Joseph opts in; Web Analytics; Lighthouse CI | about 2.5 | PR 5; his ADR opt-ins and analytics site token |
| 2 | Gate: repository public | [ADR 0012](adr/0012-public-repository.md) | 0.5 | Q7 |
| 3 | PR 4 About + Now | `/about/`, `/now/`; stillhere's card turned on; the ⌘K palette (shipped ahead on 2026-10-25 as the command menu) | about 2 | Q8–Q10; stillhere's and the GitHub profile's readiness checks |
| 4 | PR 6 Lab platform + Presence | Lab Worker; admission; budgets; recordings; `/privacy/`; kill switch | 4–5 | Q13; spikes S1–S6, running from 2026-10-23 |
| 4 | PR 7 Outbox Lab | The transactional outbox demo | 8–10 | Q12 |
| 4 | PR 8 Migration Lab | The saved-plan migration demo | 6–8 | — |
| — | Route Lab (built 2026-10-25, at Joseph's direction) | `/lab/` and `/lab/routes/`: VROOM in the visitor's browser, static, $0 to run ([ADR 0016](adr/0016-route-lab-in-the-browser.md)); it needs none of PR 6 | built | Q13; the merge gates in ADR 0016's Consequences |
| 5 | Later | A résumé PDF, Pagefind search, Mission-AI references, terminal mode | — | Q9 (b), Q24 |

Phases 1–3, a complete content site, added up to 9.5–12.5 focused days as first planned, and about 16–17 since PR 3's re-baseline and PR 4's re-estimate on 2026-10-23. Phase 4, the lab, adds 18–23. Content came first by design; on 2026-10-23 Joseph moved the blog ahead of the other content pages, made owned work cards instead of case studies, and started the lab's spikes alongside it ([roadmap.md](roadmap.md)).

## Open decisions

Recommendations that are not yet approved stay open. A blocking question stops its PR. A non-blocking question proceeds on its recommendation until Joseph answers it. Anything the firewall touches defaults to the strictest option until he clears it in writing, with one exception: for Q3 itself these docs assume the recommended (b), because drafting under (c) would strip the LinkedIn link from every page while (b) already rules out every name and description. "By" is the last point at which an answer costs no rework. The short names (Q-deploy-token and so on) are stable, and other docs use them.

### Blocking PR 2

None left: Q1 and Q2 were decided on 2026-10-22 ([Decided](#decided)).

### Blocking PR 3

| # | Question | Options | Recommendation, and why | Door | Blocks · by |
|---|---|---|---|---|---|
| Q7 · Q-visibility | Should this repository become public? | (a) Public once the firewall job is green in CI, a full-history scan is clean, and Joseph says yes. (b) Private, plus GitHub Pro for branch protection: $4 a month as of 2026-10-22.[^q7] (c) Private source, plus a public mirror that CI publishes (the pattern behind Google's Copybara) | (a). The source and the ADRs become portfolio evidence, and rulesets, required checks and Actions minutes become free. The cost: content is public at `git push`, so the local hooks become the only prevention, and clones persist. (c) keeps prevention in CI at the price of a second system | One-way: a clone keeps whatever was public | The gate after PR 3 ([ADR 0012](adr/0012-public-repository.md)); required checks · after PR 3, before PR 4 |

### Blocking PR 4

| # | Question | Options | Recommendation, and why | Door | Blocks · by |
|---|---|---|---|---|---|
| Q10 · Q-projects | Which work is featured? | (a) stillhere and gitops, plus one line for the upstream contribution to capacitor. (b) Other repositories as well | (a). Owned, checkable work, linked only after its readiness checks, with exact credit (gitops has outside contributions; capacitor is someone else's project). Partly answered on 2026-10-23: owned work shows as cards that link to the repositories, not case studies. stillhere's card waits on its readiness check and the GitHub profile's. gitops is private, so it stays off the site until it is public again. Still open: the capacitor line | Two-way | the project cards and the capacitor line in PR 4 · before PR 4 |

### Blocking PR 6 and later

| # | Question | Options | Recommendation, and why | Door | Blocks · by |
|---|---|---|---|---|---|
| Q12 · Q-first-demo | Which demo follows Presence? | (a) Outbox Lab. (b) Migration Lab. (c) Route Lab | (a). It shows a failure and its fix side by side, a naive dual write that visibly loses events next to a transactional outbox, on synthetic data, and it needs no external map data or solver. (c) brought the most outside parts (a WASM solver, map data, a travel-time matrix) on top of 7–10 days of work, so it was to ship last ([lab.md](lab.md)). On 2026-10-25 Joseph directed (c) first ("Goal post is VROOM running"), built as a static demo that needs no platform ([ADR 0016](adr/0016-route-lab-in-the-browser.md), Proposed); this row moves to Decided when he accepts that record. Which demo follows Presence is still open | Two-way | PR 7 · before PR 7 |
| Q13 · Q-ip | Has Joseph confirmed that his invention-assignment agreement does not reach his personal projects? | (a) Checked: it does not. (b) It might, or it is unclear | Read the agreement, and the statute of the state he works in, before any demo or Mission-AI reference is scheduled. Every one of them waits on (a). Not yet checked, as of 2026-10-23. Not legal advice.[^q13] | One-way: a published invention cannot be unpublished | Every demo, from PR 6; Q24 · before PR 6 |

### Non-blocking

These proceed on the recommendation until answered, ordered by when the answer is needed.

| # | Question | Options | Recommendation, and why | Door | Blocks · by |
|---|---|---|---|---|---|
| Q20 · Q-photo | A photo? | (a) None in the hero. (b) A photo on `/about/` | (a) for the hero: in the Ladders study, 19% of recruiters' time on LinkedIn profiles went to the photo. (b) is his call | Two-way | `/about/` · before PR 4 |
| Q21 · Q-segway | How far to lean into the name? | (a) Two sentences on `/about/` with the story behind "I have a Segway". (b) (a) plus a small easter egg. (c) Ignore it | (a). The domain is the most memorable thing about the site, and its story is a ready-made hook. Any glyph is a generic self-balancing scooter, with no Segway Inc. marks or implied affiliation | Two-way | `/about/` · before PR 4 |
| Q22 · Q-other-repos | Link the older private repositories? | (a) No: they stay private and unlinked. (b) Clean some and publish them | (a). The owned public work already carries the proof, and each extra repository would need the full readiness checks | Two-way | PR 4 · before PR 4 |
| Q23 · Q-writing-budget | Is 8–10 h/month of writing realistic? | (a) The full plan in [content.md](content.md): each month 1 essay, 2 field notes and 1 `/now/` update. (b) Notes only, to start | (a), with content.md's stop rule: if three months pass without a post, drop to notes only and hide Writing from Home | Two-way | PR 5 · before PR 5 |
| Q28 · Q-live-count | Should the footer's telemetry strip show a live "N here now" count on every page? | (a) No: the count stays on lab pages. (b) Yes, site-wide | (a). Site-wide, every page view would make a Worker request and a DO request and need an admission check, Turnstile or a new path without it. That ends the zero-invocation page view that [ADR 0008](adr/0008-workers-free-with-guardrails.md) rests on ([design-system.md](design-system.md), [cost.md](cost.md)) | Two-way | The strip, once Presence ships · before PR 6 |
| Q24 · Q-mission | When and how is Mission-AI referenced? | (a) Not at launch; decide later. (b) A case study. (c) A line on `/about/` | (a). It is his decision, and it needs the invention-assignment check (Q13) first | One-way once published | Phase 5 · no date |

### Decided

Joseph answered these in chat on 2026-10-22 and 2026-10-23; each row dated 2026-10-23 says so, and Q9's row, 2026-10-25, records a direction relayed to Claude. Where he did not pick an option himself, he took the recommendation, as the row says. When a question is answered, it moves here with the date, the option chosen and what ships, its door, and the evidence that would show it wrong. Detail the firewall touches stays in the private record ([Content firewall](#content-firewall)); for Q13, this section records only that the check is done, with the date. A one-way answer also gets an ADR. Each ADR stays Proposed until the pull request that [roadmap.md](roadmap.md) names accepts it.

| Question | Answer | What ships | Door | Wrong if |
|---|---|---|---|---|
| Q1 · Q-deploy-token | (a). Joseph created the account-owned token with the four permissions and a 12-month expiry, stored as the repository secret `CLOUDFLARE_API_TOKEN`; the account ID is the secret `CLOUDFLARE_ACCOUNT_ID` | PR 2's `preview`, `deploy` and `rollback` jobs ([ADR 0006](adr/0006-github-actions-owns-deploys.md)) | Two-way: revoke the token | PR 2's first deploy cannot attach the domain (spike S7), or any incident involves the token |
| Q2 · Q-mail | (a) `hello@ihaveasegway.com` through Email Routing to his personal inbox | PR 2: the Email Routing records, SPF, DMARC `p=reject`, and the address on Home | Two-way until the address is printed; after that, retiring it breaks links people kept | Spam to the address costs more than an hour a month: then a form, option (c) |
| Q3 · Q-threat-model | (b) Not described: the recommendation | All copy from PR 3; a LinkedIn link is allowed | One-way for anything published under it | The site alone names the employer, or narrows to it. A reader who follows the LinkedIn link learns the employer there by construction: that was accepted when Joseph cleared the link in writing (private record, 2026-10-23), and the site still carries nothing that adds to it |
| Q4 · Q-title | "Senior Software Engineer" | Home from PR 2; page titles, JSON-LD `jobTitle` and Open Graph images from PR 3 | Two-way on the page; one-way in caches | It stops matching LinkedIn, or the 7-second test shows visitors cannot tell what he does |
| Q5 · Q-location | (b) "US · remote" | Home from PR 2; JSON-LD `homeLocation` names the country only | Two-way on the page; one-way in caches | He wants local roles: then (a) |
| Q6 · Q-availability | (c) None at launch | No availability line, and no line about the site's own build (removed 2026-10-24); a release line waits for a repository that passes its readiness checks | Two-way on the page | The 7-second test shows visitors cannot tell whether he is open to a conversation: then (b) |
| Q11 · Q-budget | $50: an unexpected monthly Cloudflare bill above that would hurt (2026-10-23) | PR 6's guardrails: the budget alerts and the threshold at which the automatic kill switch blocks the lab API ([ADR 0008](adr/0008-workers-free-with-guardrails.md), [cost.md](cost.md)). On Workers Free the bill cannot pass $0, so it matters from the day an upgrade trigger fires | Two-way | A month's bill passes $50, or a guardrail trips on ordinary demo traffic |
| Q14 · Q-renew | (a), extended by 9 years ($94.14) before the price rise; Joseph makes the purchase in the dashboard | The registration runs to 2036-10-18 | One-way: renewals are final | After 2026-10-31, RDAP still shows 2027-10-18: the purchase did not go through |
| Q15 · Q-ai-crawlers | (a) Allow: the recommendation | No change to the zone setting | Two-way | An AI answer joins the site to something the firewall keeps off it |
| Q16 · Q-theme | (a) Follow the OS, dark-first, with a toggle: the recommendation | PR 3 | Two-way | Light mode collects more defects than dark ([ADR 0010](adr/0010-quiet-console-design-tokens.md)) |
| Q17 · Q-accent | Neither (a) nor (b): apricot, chosen on 2026-10-23 with the palette. From three directions drawn on Home's wireframe he picked C, "Instrument" (a 12-column frame with a ruler, a poster-size name and a readout row), then Petrol + Apricot from four color studies of it, with a top bar that sweeps across a card on hover ([design-system.md](design-system.md#chosen-direction)) | PR 2: `tokens.css` with the palette in both themes, contrast-tested, and Home in the direction's frame. PR 3: the typefaces (spike S9) and the rest of the direction ([ADR 0010](adr/0010-quiet-console-design-tokens.md)) | Two-way: one token file, though recognition starts at launch | The contrast test fails, or the 7-second test or a reviewer calls the look templated or distracting |
| Q18 · Q-analytics | (a) Cloudflare Web Analytics: the recommendation | The beacon, with the colophon in PR 3b | Two-way | The 90-day funnel check finds nothing to act on |
| Q19 · Q-license | (a) Code MIT; writing and images © Joseph Peterson, all rights reserved; fonts OFL: the recommendation | License files, before the repository goes public | Loosening is two-way; tightening cannot recall copies | A request to reuse the writing arrives that he wants to allow: then (c) |
| Q25 · Q-token-owner | (a): the Mission-AI values are his. He also asked for a look that is distinctive rather than what everyone else ships: creative, but not distracting. So the palette, the accent (Q17) and the typefaces are chosen in a design exploration before PR 3 | PR 2: `tokens.css` with the token names and the chosen palette (Q17), with system fonts. PR 3: the typefaces and the rest of the chosen direction ([ADR 0010](adr/0010-quiet-console-design-tokens.md)) | Two-way: one token file | The chosen direction fails the contrast test, or reviewers call it templated or distracting |
| Q26 · Q-alerts | (a) Email to his personal inbox: the recommendation | PR 2's alert routing | Two-way | An alert arrives too late on a day uptime matters (upgrade trigger 4) |
| Q29 · Q-s1-timing | (a) Before PR 6, as planned. The account's other Worker logged no requests in the 30 days to 2026-10-22 | — | Two-way | That Worker starts serving traffic before PR 6: read its peak again |
| Q27 · Q-agent-credit | Moot (2026-10-23): no case studies ship, so there is no role line to word. Owned work is a card that links to its repository (Q10) | — | Two-way | Case studies come back; then reopen it |
| Owned work's form, from Q10 | Card → repo only (2026-10-23): each owned project is a card on Home that links to its repository; no case studies, recordings or lab companions | The card's code, ahead (2026-10-23); stillhere's card in PR 4 | Two-way: `/work/` stays reserved ([ADR 0005](adr/0005-url-scheme.md)'s postscript) | Proposed, for Joseph to confirm: after 8 weeks with the card live, GitHub's Insights → Traffic → Referring sites for stillhere shows fewer than N visits from ihaveasegway.com, or people who saw the site still ask what stillhere does. N is Joseph's to set. GitHub keeps 14 days of traffic, so the count is read every two weeks |
| Q9 · Q-resume | (a) now, as a page (2026-10-25). Joseph's direction that day, relayed: "It should be a résumé". Read as the recommendation, (a) now, shaped as a page rather than a line; that reading is Claude's, for his confirmation. (b) stays open for the PDF | `/resume/`: the name, the title, the location line and every address; Experience with "Full history on LinkedIn." and "Full résumé on request"; role titles and years once Q8 is cleared and he adds them; skills with their evidence; Selected work and Writing as on Home. Print CSS gives one Letter page. No PDF is hosted ([content.md](content.md#résumé)) | Two-way for the page's content; the URL is permanent once deployed ([ADR 0005](adr/0005-url-scheme.md)); a PDF stays one-way and undecided | A recruiter cannot tell what the page adds to LinkedIn, or the thin page reads as unfinished before a role is on it: then build it only once `work` holds a role, a one-line change. **2026-10-28, on Joseph's direction** to replace the Résumé page with an About page that is his résumé plus how he works: the résumé moved to `/about/`, under his bio; `/resume/` is a 301 to it. A Print button saves the page as a PDF in the visitor's browser, from the one-page print CSS; (b), a hosted PDF, stays open and one-way |
| Q8 · Q-career-arc | None of the three (2026-10-29): the career arc stays on LinkedIn. Asked whether `/about/` should list role titles and years with no company, or keep pointing to LinkedIn, Joseph answered "Point to linked in" | `/about/`'s Experience keeps "Full history on LinkedIn." and "Full résumé on request". `profile.json` holds no roles, so Home, the JSON-LD and a printed page list none, and a hosted PDF (Q9 (b)) would add nothing over the page | Two-way: nothing is published | Recruiters ask for titles or dates that the page could have answered |

## Non-goals (v1)

- **A CMS.** Content is Markdown in the repository, validated at build ([ADR 0004](adr/0004-content-as-code.md)). Revisit if writing friction appears, for example writing from a phone: a git-based CMS such as Keystatic or TinaCMS keeps the repository as the system of record.
- **Comments.** They need moderation, storage and a privacy notice. Replies go to email.
- **A newsletter.** RSS serves subscribers at $0. A newsletter needs a sending provider and a mailing list, which is personal data to hold, and sending to arbitrary recipients from Cloudflare requires Workers Paid ([Email Routing](https://developers.cloudflare.com/email-routing/), as of 2026-10-22).
- **Internationalization.** English only, ISO dates.
- **User accounts.** There is nothing to sign in to. The site sets no cookies and stores only the theme choice, in sessionStorage, for the tab.
- **Server-side rendering.** Every page is built ahead of time. A page view runs no code, which is why the site survives a 100,000-visitor day on Workers Free ([cost.md](cost.md)).
- **Search before about 20 posts.** Then Pagefind: a static index with no runtime cost, which can also feed the command menu.
- **Employer case studies.** The firewall rules them out. Depth comes from owned work.
- **Mission-AI content at launch.** Later, by Joseph's decision (Q24).
- **A hosted résumé PDF.** The current résumé is never hosted or committed. The public edition is an HTML page at `/resume/`, generated from `profile.json` (Q9 (a), 2026-10-25); a PDF of it comes only after the firewall questions are answered (Q9 (b)).

## How we will know it works

- **A recruiter gets it in 7 seconds.** Before PR 3 merges, show Home on its preview for 7 seconds to 5 recruiters or hiring managers. At least 4 recall his name, his title, one proof point and how to contact him. If 2 or more cannot, rewrite the hero before PR 3 merges.
- **It stays fast and accessible.** Every budget in [design-system.md](design-system.md#budgets-as-ci-fitness-functions) passes in CI, where a failing one fails the build ([delivery.md](delivery.md)). The one a visitor feels first: LCP at p75 on mobile ≤2.5 s, with 1.5 s as the target.
- **It costs nothing to run.** The Cloudflare bill stays at $0 until an upgrade trigger fires. Year one costs $11.17, the domain alone, or $10.46 a year if it is extended before the price rise (Q14) ([cost.md](cost.md), [ADR 0008](adr/0008-workers-free-with-guardrails.md)).
- **It is manageable alone.** Maintenance (dependency PRs, the weekly audits, incidents) takes ≤2 h a month, writing excluded. The [maintenance calendar](operations.md#maintenance-calendar) puts the planned part at about 1 h 50 min a month before the lab; the lab's additions have to fit by PR 6, or this target changes with the time log as evidence ([roadmap.md](roadmap.md)). Log the real time for the first 3 months; if it runs over, cut scope before adding automation, since automation is one more thing to maintain.
- **It is in the funnel.** After 90 days of Web Analytics (from PR 3b), at least 20% of Home visits continue to `/about/`, and LinkedIn and GitHub appear among the referrers. A card's outbound click is invisible to the beacon, so it is counted on GitHub's side: stillhere's Insights → Traffic → Referring sites lists ihaveasegway.com, because the site sends its origin as the referrer (`strict-origin-when-cross-origin`, [security.md](security.md)). GitHub keeps 14 days, so it is read every two weeks. Links clicked in a PDF résumé usually arrive with no referrer and count as direct visits, so the résumé's share is not measured. The 20% is a starting threshold to calibrate, and ad blockers undercount this audience.
- **The writing habit holds.** Measured as [content.md](content.md) defines it: did a post ship this month, and did one come up in a conversation. Page views do not measure the habit (Julia Evans lists "page views matter" among the [blogging myths](https://jvns.ca/blog/2023/06/05/some-blogging-myths/)). Three months without a post triggers the stop rule.
- **The firewall holds.** Zero firewall findings reach a deployed page or a public commit. A finding caught in CI is the system working; a finding that gets past it is an incident ([operations.md](operations.md)).

## Glossary

- **ADR (architecture decision record):** one file per decision that is hard to reverse: context, decision, alternatives, consequences, door, revisit if ([adr/README.md](adr/README.md)).
- **Assets-only Worker:** a Cloudflare Worker with no script, only static files. Requests to it are free and unlimited and never count toward Worker request limits. The site is one, named `ihaveasegway-web`.
- **Bulkhead:** a partition that keeps a failure in one part from sinking the rest. Here, pages run no code, and all code sits in a separate lab Worker.
- **Canary (firewall):** a random marker generated at run time and fed through the firewall check. If the check does not flag it, the rules did not load, and the check fails.
- **Colo:** the Cloudflare data center that served a request. No page shows it: the served-from readout was dropped on 2026-10-24.
- **Content firewall:** the policy above that keeps the current employer and the private venture out of the site, the repository and commit metadata, and the check that enforces it.
- **Door:** an ADR field. A one-way door is expensive or impossible to reverse (a shared URL, a published page, a public repository); a two-way door is reversed in a PR.
- **Durable Object (DO):** a Cloudflare object with its own storage and single-threaded execution, addressed by name: the virtual-actor pattern. The lab's demos run in DOs.
- **Error 1027:** the error Cloudflare serves in place of a Worker's response once a Free-plan account has used its 100,000 Worker requests for the day.
- **Fail-safe default:** when a control is unsure, it chooses the outcome that cannot cause harm: no deploy, no bill, recorded mode instead of live.
- **Fitness function:** an automated check that an architectural property still holds, such as a page-weight budget in CI.
- **Hibernation:** the DO WebSocket mode in which an idle object leaves memory while its connections stay open. An object that is idle and eligible for hibernation is not billed for duration.
- **Island:** an interactive component hydrated on its own inside an otherwise static page (islands architecture). Content pages ship none; React islands appear only on lab pages that need them.
- **Kill switch:** the layered controls that stop the lab, from a per-demo budget breaker, through a web application firewall (WAF) rule that blocks `/lab/api/`, to deleting the route ([lab.md](lab.md)).
- **Mosaic effect:** details that are harmless alone and identifying together.
- **Instrument:** the site's design language, direction C of the 2026-10-23 exploration. Its feel comes from structure and type (a 12-column frame, a poster-size name, small mono labels for dates and figures), not from neon ([design-system.md](design-system.md)).
- **Quiet Console:** the design language PR 1 planned (Mission-AI's zinc, a teal accent, hairline grids, corner brackets); Instrument replaced it on 2026-10-23 and kept its structure ([design-system.md](design-system.md#lineage)).
- **Recorded fallback:** a static recording of a demo's server messages that the page replays when live mode is unavailable.
- **Revisit if:** an ADR field naming the evidence that would show the decision was wrong.
- **Spike:** a small throwaway experiment that answers one platform question before the plan relies on it (S1–S9 in [roadmap.md](roadmap.md)).
- **System of record:** the one place a piece of data is written and owned. Everything else reads it or holds a derived copy.
- **Upgrade trigger:** an event that moves the account from Workers Free to Workers Paid ([ADR 0008](adr/0008-workers-free-with-guardrails.md)).
- **Version URL:** a URL that serves one uploaded version of a Worker before it takes traffic. The deploy job smoke-tests it before promoting the version.
- **WIP limit:** a cap on work in progress. Here, one PR in flight, relaxed on 2026-10-23 for one stacked branch ([roadmap.md](roadmap.md#how-we-work)).
- **Worker Preview:** a preview deployment of a Worker for one pull request, on `workers.dev`: public, but marked `noindex`.

## Patterns and further reading

- Inverted pyramid and progressive disclosure, for the order of Home: Amy Schade, "Inverted Pyramid: Writing for Comprehension" (NN/g, 2018).
- The mosaic effect: OMB Memorandum M-13-13, "Open Data Policy: Managing Information as an Asset" (2013).
- Fail-safe defaults: Jerome Saltzer and Michael Schroeder, "The Protection of Information in Computer Systems" (1975).
- Bulkheads: Michael Nygard, *Release It!*, 2nd edition, "Stability Patterns".
- Islands architecture: Jason Miller, "Islands Architecture" (2020).
- One-way and two-way doors: Jeff Bezos, 2015 letter to Amazon shareholders.
- Systems of record and derived data: Martin Kleppmann, *Designing Data-Intensive Applications*, Part III.
- Fitness functions: Neal Ford, Rebecca Parsons, Patrick Kua and Pramod Sadalage, *Building Evolutionary Architectures*, 2nd ed., chapter 2.
- Goals, non-goals and alternatives considered: Malte Ubl, "Design Docs at Google" (2020).
- Publish on your own site, syndicate elsewhere: IndieWeb, ["POSSE"](https://indieweb.org/POSSE).
- Writing as a lever for staff-plus engineers: Will Larson, "Being visible" (2020).
- Every source, with links: [reading-list.md](reading-list.md).

[^q1]: (b) needs required checks, which a private repository on GitHub Free cannot have. Without them every merge to `main` would deploy whatever CI reported, and the pipeline would be split across two systems. Revisit (b) once the repository is public with required checks and the token held in GitHub has become the larger risk ([ADR 0006](adr/0006-github-actions-owns-deploys.md)).
[^q7]: Branch protection for private repositories needs GitHub Pro ([plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)). The price is from GitHub's [plans FAQ](https://docs.github.com/en/get-started/learning-about-github/faq-about-changes-to-githubs-plans); the [pricing page](https://github.com/pricing) no longer lists Pro, so confirm it in billing settings before buying ([ADR 0012](adr/0012-public-repository.md)).
[^q13]: Working on his own time and equipment is not enough on its own: even statutes written to protect employees carve out exceptions, as California's Labor Code § 2870 does ([text](https://codes.findlaw.com/ca/labor-code/lab-sect-2870/), current as of 2026-01-01).
[^q14]: As of 2026-10-22, Cloudflare charges $10.46 for .com (a third-party [price list](https://cfdomainpricing.com/), updated 2026-10-21): the $10.26 wholesale fee plus ICANN's $0.20 per domain-year ([ICANN](https://www.icann.org/en/announcements/details/icann-accredited-registrars-approve-registrar-level-fees-for-fiscal-year-2026-21-07-2025-en)). The wholesale fee rises to $10.97 on 2026-11-01 ([Domain Name Wire](https://domainnamewire.com/2026/04/23/breaking-verisign-raising-wholesale-com-prices/)), which puts a renewal at about $11.17. Renewals are final ([renewals](https://developers.cloudflare.com/registrar/account-options/renew-domains/)).
