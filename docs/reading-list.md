# Reading list

Every pattern and concept these docs name, mapped to one canonical source, with one line on why it matters here. Each source is either the original or the clearest treatment, and one is enough to start with. Other docs sometimes cite a second source next to a pattern; this list picks one.

Status: Draft for review in PR 1 · 2026-10-22

Every link below resolved when checked on 2026-10-22. Three pages (the PubMed record and the two w3.org pages) refuse scripted checks, so those were confirmed separately. Books link to the book's own site or a catalogue page, and the entry names the chapter.

## Decisions and documentation

| Concept | Canonical source | Why it is here |
|---|---|---|
| Architecture decision record (ADR) | Michael Nygard, ["Documenting Architecture Decisions"](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (2011) | The format of every ADR in this repository, and the case for a decision log over memory ([ADR 0001](adr/0001-record-architecture-decisions.md)) |
| One-way and two-way doors | Jeff Bezos, [2015 letter to Amazon shareholders](https://s2.q4cdn.com/299287126/files/doc_financials/annual/2015-Letter-to-Shareholders.PDF) (Type 1 and Type 2 decisions) | The Door field: decide two-way doors fast, write one-way doors down |
| Alternatives considered | Malte Ubl, ["Design Docs at Google"](https://www.industrialempathy.com/posts/design-docs-at-google/) (2020) | Why the options that lost are the most useful part of a decision write-up, and of a case study |
| C4 model | Simon Brown, [The C4 model](https://c4model.com/) | The context and container diagrams in [architecture.md](architecture.md): one diagram per level of zoom |
| Last responsible moment | Mary and Tom Poppendieck, [*Lean Software Development: An Agile Toolkit*](https://www.informit.com/store/lean-software-development-an-agile-toolkit-9780321150783) (2003), ch. 3, "Decide as Late as Possible" | Why each open decision is due before the pull request it blocks, not all up front ([roadmap.md](roadmap.md)) |
| Docs as code | Write the Docs, ["Docs as Code"](https://www.writethedocs.org/guide/docs-as-code/) | Writing documentation with the same tools as code: these docs and the site's content live in the repo, change by pull request and pass the same checks ([ADR 0004](adr/0004-content-as-code.md)) |

## Architecture and data ownership

| Concept | Canonical source | Why it is here |
|---|---|---|
| Bounded context, anticorruption layer, published language | Eric Evans, [*Domain-Driven Design Reference*](https://domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (2015) | Each demo is its own context; one function translates GitHub's data into the site's own record; protocol v1 is a published language |
| System of record and derived data | Martin Kleppmann, [*Designing Data-Intensive Applications*](https://dataintensive.net/) (2017), Part III introduction, "Systems of Record and Derived Data" | One owner per piece of data: the repository owns content, LinkedIn owns employment history, and the colophon is derived from `docs/adr/` |
| Single source of truth (DRY) | Andrew Hunt and David Thomas, [*The Pragmatic Programmer*](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/), 20th anniversary ed. (2019), "DRY: The Evils of Duplication" | "Every piece of knowledge must have a single, unambiguous, authoritative representation": one nav manifest, one token file, one profile |
| Single writer | Martin Thompson, ["Single Writer Principle"](https://mechanical-sympathy.blogspot.com/2011/09/single-writer-principle.html) (2011) | Written about memory and applied here to data and deploys: one writer per resource removes coordination, so one pipeline deploys production |
| Multi-leader replication and last write wins | Kleppmann, *Designing Data-Intensive Applications*, ch. 5, "Multi-Leader Replication" | What two deployers on one Worker would be: concurrent writers whose last deploy silently wins. The reason Workers Builds and the Actions deploy job never both run ([ADR 0006](adr/0006-github-actions-owns-deploys.md)) |
| Schema-on-write | Kleppmann, *Designing Data-Intensive Applications*, ch. 2, "Schema flexibility in the document model" | Front matter is validated at build, so a bad post fails the build instead of the page |
| Make illegal states unrepresentable | Yaron Minsky, ["Effective ML Revisited"](https://blog.janestreet.com/effective-ml-revisited/) (Jane Street, 2011) | The `profile` schema has no field for an employer and rejects unknown keys, so the build refuses one instead of rendering it ([content.md](content.md)) |
| Eventual consistency | Werner Vogels, ["Eventually Consistent"](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) (2008) | GitHub facts are read at build time; the site is as fresh as its last deploy, and its readers need no more |
| Snapshots across a boundary | Pat Helland, ["Data on the Outside versus Data on the Inside"](https://www.cidrdb.org/cidr2005/papers/P12.pdf) (CIDR 2005) | Data copied across a boundary should be an immutable, dated snapshot, as the build-time copy of GitHub's release data is |
| Virtual actor | Philip Bernstein et al., ["Orleans: Distributed Virtual Actors for Programmability and Scalability"](https://www.microsoft.com/en-us/research/publication/orleans-distributed-virtual-actors-for-programmability-and-scalability/) (Microsoft Research, 2014) | Durable Objects (DOs) are virtual actors: addressed by name, created on first call, one thread each |
| Client-side composition | Chris Richardson, ["Pattern: Client-side UI composition"](https://microservices.io/patterns/ui/client-side-ui-composition.html) (microservices.io) | The browser loads the site and the lab separately; the site never calls the lab, so a lab outage leaves every page up ([lab.md](lab.md)) |
| CQRS | Martin Fowler, ["CQRS"](https://martinfowler.com/bliki/CQRS.html) (2011) | Separate models for writing and reading, with Fowler's warning that "for most systems CQRS adds risky complexity"; one of the patterns the stillhere case study names ([content.md](content.md)) |
| Ports and adapters | Alistair Cockburn, ["The Hexagonal (Ports & Adapters) Architecture"](https://alistair.cockburn.us/hexagonal-architecture/) (2005) | The core owns its interfaces and each platform plugs in an adapter: stillhere enforces it in CI, and the gitops-in-the-browser idea in [lab.md](lab.md) depends on it |
| Reconciliation (control loop) | Kubernetes, ["Controllers"](https://kubernetes.io/docs/concepts/architecture/controller/) | Compare desired with observed state and act on the difference, instead of inferring state from events: the gitops reconcile behind an essay in [content.md](content.md) |
| Choose boring technology | Dan McKinley, ["Choose Boring Technology"](https://mcfunley.com/choose-boring-technology) (2015) | The stack spends its novelty on DOs and keeps every other layer conventional ([stack.md](stack.md)) |

## Rendering and the web

| Concept | Canonical source | Why it is here |
|---|---|---|
| Islands architecture | Jason Miller, ["Islands Architecture"](https://jasonformat.com/islands-architecture/) (2020) | Zero JavaScript by default, with interactive islands only where a demo needs one ([ADR 0003](adr/0003-astro-static-first.md)) |
| Static rendering and hydration cost | Jason Miller and Addy Osmani, ["Rendering on the Web"](https://web.dev/articles/rendering-on-the-web) (web.dev) | Explains the gap between a static page with no JavaScript and a framework page that hydrates everything |
| Progressive enhancement | Jeremy Keith, [*Resilient Web Design*](https://resilientwebdesign.com/chapter6/) (2016), ch. 6, "Steps" | Core content in plain HTML first; view transitions, the palette and the effects are additions that may fail |
| Cool URIs | Tim Berners-Lee, ["Cool URIs don't change"](https://www.w3.org/Provider/Style/URI) (1998) | Why the URL scheme is nearly a one-way door and slugs never change ([ADR 0005](adr/0005-url-scheme.md)) |
| URL as UI | Jakob Nielsen, ["URL as UI"](https://www.nngroup.com/articles/url-as-ui/) (NN/g, 1999) | Every prefix of a page URL is itself a page, so a visitor can trim `/work/gitops/` to `/work/` |
| Inverted pyramid | NN/g, ["Inverted Pyramid: Writing for Comprehension"](https://www.nngroup.com/articles/inverted-pyramid/) | Each page starts with its conclusion, and the detail follows for whoever stays |
| Progressive disclosure | Jakob Nielsen, ["Progressive Disclosure"](https://www.nngroup.com/articles/progressive-disclosure/) (NN/g, 2006) | Home answers the 10-second questions; case studies, decisions and demos sit one click down |

## Resilience, overload and cost

| Concept | Canonical source | Why it is here |
|---|---|---|
| Bulkhead, circuit breaker, steady state | Michael Nygard, [*Release It!*, 2nd ed.](https://pragprog.com/titles/mnee2/release-it-second-edition/) (2018), ch. 5, "Stability Patterns" | The site and the lab are separate Workers; the kill switch trips like a breaker; TTL alarms and `deleteAll()` keep demo state from piling up ([ADR 0009](adr/0009-lab-worker-same-origin.md)) |
| Admission control | Google, [*Site Reliability Engineering*, ch. 21, "Handling Overload"](https://sre.google/sre-book/handling-overload/) | Per-client limits and refusing work early: Turnstile, the session cookie, the rate limit, then LabControl's budget |
| Load shedding and graceful degradation | Google, [*Site Reliability Engineering*, ch. 22, "Addressing Cascading Failures"](https://sre.google/sre-book/addressing-cascading-failures/) | Recorded mode is the degraded answer a visitor gets instead of an error when a budget runs out |
| Token bucket | Paul Tarjan, ["Scaling your API with rate limiters"](https://stripe.com/blog/rate-limiters) (Stripe, 2017) | The per-socket limiter, and how Stripe layers rate limiters and load shedders |
| Lease and TTL | Cary Gray and David Cheriton, ["Leases: An Efficient Fault-Tolerant Mechanism for Distributed File Cache Consistency"](https://www.andrew.cmu.edu/course/15-440/assets/READINGS/gray1989.pdf) (SOSP 1989) | Lab sessions and rooms end unless renewed, so a lost client costs at most one term ([cost.md](cost.md)) |
| Kill switch as an ops toggle | Pete Hodgson, ["Feature Toggles (aka Feature Flags)"](https://martinfowler.com/articles/feature-toggles.html) (martinfowler.com, 2017) | The per-demo flag (live, recorded, off) that is flipped without a deploy |
| Budget-to-action breaker | Google Cloud, ["Disable billing usage with notifications"](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications) | The shape of the Paid-plan cron breaker that turns on the WAF rule, including the warning that alerts lag spend ([ADR 0008](adr/0008-workers-free-with-guardrails.md)) |
| Denial of wallet | Daniel Kelly, Frank Glavin and Enda Barrett, ["Denial of Wallet: Defining a Looming Threat to Serverless Computing"](https://arxiv.org/abs/2104.08031) (2021) | Attacks aimed at the bill: why the Free plan's hard ceiling and the guardrails exist |
| Reserve, then settle (authorize, then capture) | Stripe, ["Place a hold on a payment method"](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) | Authorize an amount now, capture what was actually used later, and release the rest: how `LabControl` reserves a session's ceiling at admission and releases the difference when the session ends ([lab.md](lab.md)) |

## Messaging and data change (the lab)

| Concept | Canonical source | Why it is here |
|---|---|---|
| Transactional outbox | Chris Richardson, ["Pattern: Transactional outbox"](https://microservices.io/patterns/data/transactional-outbox.html) (microservices.io) | What the Outbox Lab shows, with its polling publisher, next to the naive dual write it replaces ([lab.md](lab.md)) |
| Idempotency key | Brandur Leach, ["Designing robust and predictable APIs with idempotency"](https://stripe.com/blog/idempotency) (Stripe, 2017) | Commands and events carry an id, so a retry or a replay has no second effect |
| Dead-letter queue | Gregor Hohpe and Bobby Woolf, *Enterprise Integration Patterns* (2003), ["Dead Letter Channel"](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html) | Where a poison event goes after its last retry, so one bad message cannot block the rest |
| Exponential backoff with full jitter | Marc Brooker, ["Exponential Backoff And Jitter"](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) (AWS Architecture Blog, 2015) | Retries spread out at random instead of arriving together |
| Event envelope | [CloudEvents specification](https://cloudevents.io/) (CNCF) | The Outbox Lab's events use a standard envelope, validated before they are written |
| Versioned messages | Kleppmann, *Designing Data-Intensive Applications*, ch. 4, "Encoding and Evolution" | Protocol v1's version field is the one-way door: bump it, never change what a version means |
| Tolerant reader | Martin Fowler, ["TolerantReader"](https://martinfowler.com/bliki/TolerantReader.html) (2011) | An optional field or an event type old readers can ignore stays inside v1 |
| Optimistic concurrency | H. T. Kung and John Robinson, ["On Optimistic Methods for Concurrency Control"](https://www.eecs.harvard.edu/~htk/publication/1981-tods-kung-robinson.pdf) (ACM TODS, 1981) | Route Lab's room accepts a submitted plan only if it was computed against the current version |
| Expand/contract | Danilo Sato, ["ParallelChange"](https://martinfowler.com/bliki/ParallelChange.html) (martinfowler.com, 2014) | The step order for DO class and data changes, and the order the Migration Lab's planner emits |
| Saved-plan semantics | HashiCorp, [Terraform `apply`, saved plan mode](https://developer.hashicorp.com/terraform/cli/commands/apply) | Apply executes exactly the plan that was reviewed; the Migration Lab's plan hash enforces the same rule |
| Decider | Jérémie Chassaing, ["Functional Event Sourcing Decider"](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider) (2021) | Each demo's `decide` and `evolve` functions run the same in the DO, in the browser and in replay |
| Functional core, imperative shell | Gary Bernhardt, ["Boundaries"](https://www.destroyallsoftware.com/talks/boundaries) (2012) | The domain core has no platform imports; the DO, the browser and the tests are thin shells around it |
| Multiplayer authority model and snapshot on join | Evan Wallace, ["How Figma's multiplayer technology works"](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) (2019) | The server's state is the truth and clients converge on its snapshot, in Presence and every lab room |

## Delivery and testing

| Concept | Canonical source | Why it is here |
|---|---|---|
| Deployment pipeline | Jez Humble and David Farley, [*Continuous Delivery*](https://continuousdelivery.com/) (2010), ch. 5, "Anatomy of the Deployment Pipeline" | Build once, gate, promote the same artifact ([ADR 0006](adr/0006-github-actions-owns-deploys.md)) |
| Blue/green deployment | Martin Fowler, ["BlueGreenDeployment"](https://martinfowler.com/bliki/BlueGreenDeployment.html) (2010) | Upload a version, smoke-test its Version URL, then promote it |
| Cache busting by content hash | Jake Archibald, ["Caching best practices & max-age gotchas"](https://jakearchibald.com/2016/caching-best-practices/) (2016) | Never change the content at a URL; change the URL. Hashed asset names can then be cached for a year as `immutable` while HTML revalidates ([delivery.md](delivery.md)) |
| Canary release | Google, [*The Site Reliability Workbook*, "Canarying Releases"](https://sre.google/workbook/canarying-releases/) | When gradual deploys pay off, and why this site deploys at 100%: one small visitor stream gives no signal to read |
| Infrastructure as code and configuration drift | Martin Fowler, ["InfrastructureAsCode"](https://martinfowler.com/bliki/InfrastructureAsCode.html) (2016) | When IaC earns its cost; until a trigger fires, the zone stays in the dashboard with an audit script, and an emergency change is written back into the checklist (checklist in [security.md](security.md), triggers in [operations.md](operations.md)) |
| Policy as code | HashiCorp, ["Policy as Code"](https://developer.hashicorp.com/sentinel/docs/concepts/policy-as-code) (Sentinel docs) | The content firewall is versioned, tested code that CI runs, not a rule someone has to remember |
| Fitness function | Neal Ford, Rebecca Parsons, Patrick Kua and Pramod Sadalage, [*Building Evolutionary Architectures*, 2nd ed.](https://www.thoughtworks.com/en-us/insights/books/building-evolutionaryarchitectures-second-edition), ch. 2, "Fitness Functions" | Page-weight budgets, the contrast test and the `cache.enabled` check fail the build ([design-system.md](design-system.md)) |
| Walking skeleton | Steve Freeman and Nat Pryce, [*Growing Object-Oriented Software, Guided by Tests*](https://growing-object-oriented-software.com/toc.html) (2009), ch. 4, "Kick-Starting the Test-Driven Cycle" | PR 2: the thinnest slice that builds, deploys and rolls back before any feature exists. The term is Alistair Cockburn's; this chapter gives the build-deploy-test version |
| Dependency cooldowns | William Woodruff, ["We should all be using dependency cooldowns"](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns) (2025) | Why pnpm's release-age gate and Dependabot's cooldown wait days before taking a new version ([delivery.md](delivery.md)) |
| Deterministic tests | Martin Fowler, ["Eradicating Non-Determinism in Tests"](https://martinfowler.com/articles/nonDeterminism.html) (2011) | A flaky test teaches people to ignore red builds; quarantine it and fix the cause |
| Golden-master (characterization) tests | Michael Feathers, [*Working Effectively with Legacy Code*](https://www.informit.com/store/working-effectively-with-legacy-code-9780131177055) (2004), on characterization tests | Recorded demo runs double as golden masters: a change that alters a recording is a change in behavior |
| YAGNI | Martin Fowler, ["Yagni"](https://martinfowler.com/bliki/Yagni.html) (2015) | No `packages/` and no Turborepo until a second consumer exists |

Two different things are called a canary in these docs. A canary release, above, sends a small share of traffic to a new version. The firewall's canary is a random marker fed through the scanner on every run to prove its rules loaded: a known-answer test (below), not a release technique.

## Operations

| Concept | Canonical source | Why it is here |
|---|---|---|
| Black-box monitoring and actionable alerts | Google, [*Site Reliability Engineering*, ch. 6, "Monitoring Distributed Systems"](https://sre.google/sre-book/monitoring-distributed-systems/) | Uptime checks run from outside Cloudflare, and every alert names an action to take ([operations.md](operations.md)) |
| Toil | Google, [*Site Reliability Engineering*, ch. 5, "Eliminating Toil"](https://sre.google/sre-book/eliminating-toil/) | Manual, repetitive work that grows with the system: the 2-hours-a-month maintenance target is a toil budget |
| Incident management | Google, [*Site Reliability Engineering*, ch. 14, "Managing Incidents"](https://sre.google/sre-book/managing-incidents/) | Each incident follows its runbook and ends with a short note; the book's incident roles collapse into one person here |
| Blameless postmortems | Google, [*Site Reliability Engineering*, ch. 15, "Postmortem Culture: Learning from Failure"](https://sre.google/sre-book/postmortem-culture/) | Incident notes record causes and fixes, not fault |
| Secret handling and rotation | OWASP, [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) | The deploy token expires and is rotated on a schedule; the firewall rules are rotated with a full-history scan |

## Security, privacy and the firewall

| Concept | Canonical source | Why it is here |
|---|---|---|
| Threat modeling and trust boundaries | [Threat Modeling Manifesto](https://www.threatmodelingmanifesto.org/) (2020) | Its four questions start with what the system is and what can go wrong; Q-threat-model in [product.md](product.md) asks the second one about the content firewall |
| Fail-safe defaults, least privilege, open design (Kerckhoffs's principle) | Jerome Saltzer and Michael Schroeder, ["The Protection of Information in Computer Systems"](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html) (1975), section I.A.3, "Design Principles" | The firewall's exit 2 and admission's fall back to recorded; the scoped deploy token; a public firewall design whose only secret is the term list ([ADR 0007](adr/0007-content-firewall.md)) |
| Defense in depth | NIST CSRC glossary, ["defense-in-depth"](https://csrc.nist.gov/glossary/term/defense_in_depth) | The firewall has three layers (local hooks, CI, the pull request checklist), so no single one has to hold |
| Known-answer test | NIST CSRC glossary, ["known answer test"](https://csrc.nist.gov/glossary/term/known_answer_test) | Feed a check an input whose answer is known: the firewall canary, and a TLS check made with a client that can still offer the old version |
| Mosaic effect | US Office of Management and Budget, [Memorandum M-13-13](https://obamawhitehouse.archives.gov/sites/default/files/omb/memoranda/2013/m-13-13.pdf) (2013) | Facts that are harmless alone can identify together, which is why the firewall covers descriptions, not just names |
| Untrusted input in CI | GitHub Security Lab, ["Keeping your GitHub Actions and workflows secure Part 2: Untrusted input"](https://securitylab.github.com/resources/github-actions-untrusted-input/) | Pull request titles, bodies and branch names reach scripts through `env:`, never through `${{ }}` inside `run:` |
| HTTP security headers | OWASP, [HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html) | The header baseline, and why `X-XSS-Protection: 1` and `Expect-CT` are not sent |
| Same-origin policy | MDN, ["Same-origin policy"](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) | The lab shares the site's origin, so it needs no CORS; a separate lab hostname would buy origin isolation at the cost of CORS and cookie work ([ADR 0009](adr/0009-lab-worker-same-origin.md)) |
| Cross-site WebSocket hijacking | OWASP, [WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) | WebSocket upgrades ignore CORS, so the lab checks `Origin` and its cookie is `SameSite=Strict` |
| Supply-chain integrity | [SLSA](https://slsa.dev/) (Supply-chain Levels for Software Artifacts) | What signed releases and provenance protect against: gitops' keyless signing is the example in [content.md](content.md) |
| Private source, public mirror | Google, [Copybara](https://github.com/google/copybara) | The alternative to a public repository: CI publishes a filtered mirror ([ADR 0012](adr/0012-public-repository.md)) |
| Pseudonymous counting with a daily salt | Plausible, ["Data policy"](https://plausible.io/data-policy) | Lab logs keep an HMAC of the IP address with a salt that changes every UTC day, never the address itself |

## Domain and mail

| Concept | Canonical source | Why it is here |
|---|---|---|
| HSTS ramp and preload | [hstspreload.org](https://hstspreload.org/) | Raise max-age in steps before preloading, because removal takes months to reach browsers ([ADR 0011](adr/0011-dnssec-and-hsts-ramp.md)) |
| Deprecating TLS 1.0 and 1.1 | [RFC 8996](https://www.rfc-editor.org/rfc/rfc8996.html) (2021) | Why the zone's minimum TLS version moves to 1.2 |
| Null MX | [RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html) (2015) | The no-mail posture, and why it cannot coexist with Email Routing's MX records |
| Mail posture for a domain that sends nothing | M3AAWG, ["Protecting Parked Domains Best Common Practices"](https://m3aawg.org/M3AAWG-Protecting-Parked-Domains-BCP-update-2022-06) (2022) | Null MX, SPF `-all` and DMARC `p=reject` on a domain that sends no mail |
| security.txt | [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116.html) (2022) | Contact and Expires at `/.well-known/security.txt`; a weekly job checks that Expires stays in the future |

## Design and accessibility

| Concept | Canonical source | Why it is here |
|---|---|---|
| OKLab | Björn Ottosson, ["A perceptual color space for image processing"](https://bottosson.github.io/posts/oklab/) (2020) | The math under `oklch()`: equal lightness looks equally light, so contrast can be designed rather than discovered |
| OKLCH in CSS | Evil Martians, ["OKLCH in CSS: why we moved from RGB and HSL"](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) | Practical oklch tokens, palettes and gamut limits |
| Accessible color systems | Stripe, ["Designing accessible color systems"](https://stripe.com/blog/accessible-color-systems) (2019) | Contrast built into the palette with tooling: the model for the CI contrast test |
| Design tokens: three tiers and their names | Nathan Curtis, ["Naming Tokens in Design Systems"](https://nathanacurtis.substack.com/p/naming-tokens-in-design-systems-9e86c7444676) | Primitive values, semantic names, component tokens: why the tokens keep semantic names over raw color values ([ADR 0010](adr/0010-quiet-console-design-tokens.md)) |
| No-motion-first | Tatiana Mac, ["prefers-reduced-motion: Taking a no-motion-first approach to animations"](https://www.tatianamac.com/posts/prefers-reduced-motion) | Motion lives inside `prefers-reduced-motion: no-preference`, so a visitor who asks for less motion gets none |
| Motion durations | NN/g, ["Executing UX Animations: Duration and Motion Characteristics"](https://www.nngroup.com/articles/animation-duration/) | The evidence behind short durations, ease-out for entering elements and faster exits |
| WCAG 2.2 | W3C, [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/) | The intent behind each criterion the effects must meet: 2.2.2, 2.1.4, 2.3.1, 2.4.11, 1.4.11, 1.4.1 |
| Core Web Vitals | web.dev, ["Web Vitals"](https://web.dev/articles/vitals) | Where the LCP, CLS and INP thresholds in the budgets come from |
| Interaction restraint | Rauno Freiberg, ["Invisible Details of Interaction Design"](https://rauno.me/craft/interaction-design) | Why the palette opens instantly and each effect fires once |
| Recognition over recall | Raluca Budiu, ["Memory Recognition and Recall in User Interfaces"](https://www.nngroup.com/articles/recognition-and-recall/) (NN/g, 2024) | The navigation stays visible; the ⌘K palette is a shortcut, never the only way in |
| Scroll-jacking | NN/g, ["Scrolljacking 101"](https://www.nngroup.com/articles/scrolljacking-101/) | The evidence behind rejecting the most common "cool site" mistake |

## Evidence and measurement

| Concept | Canonical source | Why it is here |
|---|---|---|
| Measurement validity | Cem Kaner and Walter Bond, ["Software Engineering Metrics: What Do They Measure and How Do We Know?"](https://kaner.com/pdfs/metrics2004.pdf) (METRICS 2004) | Does a number measure what it claims? stillhere published the answer for its own headline metric, which makes it the lead case study |
| Rule of three (evidence from zero failures) | James Hanley and Abby Lippman-Hand, ["If nothing goes wrong, is everything all right? Interpreting zero numerators"](https://pubmed.ncbi.nlm.nih.gov/6827763/) (JAMA, 1983) | Zero failures in n runs bounds the failure rate at about 3/n: what 20 clean runs of a smoke test do and do not prove ([delivery.md](delivery.md)) |
| Measure before optimizing | Rob Pike, ["Notes on Programming in C"](https://www.lysator.liu.se/c/pikestyle.html) (1989), "Rule 2. Measure." | Profile first, then build the cache, or find you do not need one: an essay in the writing backlog |

## Audience, writing and career

| Concept | Canonical source | Why it is here |
|---|---|---|
| Recruiter attention | TheLadders, ["Keeping an Eye on Recruiter Behavior"](https://www.bu.edu/com/files/2018/10/TheLadders-EyeTracking-StudyC2.pdf) (2012) | About 6 seconds on a first scan, about 80% of it on six fields: the reason for Home's 7-second budget |
| Time on page | Jakob Nielsen, ["How Long Do Users Stay on Web Pages?"](https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/) (NN/g, 2011) | Visitors decide within about 10 seconds whether to stay |
| Attention above the fold | NN/g, ["Scrolling and Attention"](https://www.nngroup.com/articles/scrolling-and-attention/) | 57% of viewing time went above the fold in its 2018 data, so the first rows of Home carry the page |
| Low contrast in the wild | WebAIM, ["The WebAIM Million"](https://webaim.org/projects/million/) (2026) | Low-contrast text on 83.9% of the top million home pages: the main risk of a neon palette |
| Publish on your own site, syndicate elsewhere (POSSE) | IndieWeb, ["POSSE"](https://indieweb.org/POSSE) | Each post lives here first at its canonical URL; LinkedIn and other networks get copies that link back ([product.md](product.md)) |
| Being visible | Will Larson, ["Being visible"](https://lethain.com/being-visible/) | Why visibility matters for Staff-plus roles, and why it does not replace learning |
| What to blog about | Simon Willison, ["What to blog about"](https://simonwillison.net/2022/Nov/6/what-to-blog-about/) (2022) | TILs and project write-ups, the two post types a cadence can sustain |
| Blogging myths | Julia Evans, ["Some blogging myths"](https://jvns.ca/blog/2023/06/05/some-blogging-myths/) (2023) | No need to be an expert, original or long, and page views do not measure the habit |
| Brag document | Julia Evans, ["Get your work recognized: write a brag document"](https://jvns.ca/blog/brag-documents/) (2019) | A private record of work that cannot be shown publicly. It stays private: posts come only from owned work and general architecture ([content.md](content.md#writing-plan)) |

## Working method

| Concept | Canonical source | Why it is here |
|---|---|---|
| WIP limits, small batches, Little's law | Donald Reinertsen, [*The Principles of Product Development Flow*](https://www.goodreads.com/en/book/show/6278270-the-principles-of-product-development-flow) (2009), ch. 3 (queues), ch. 5 (batch size), ch. 6 (WIP constraints) | One pull request in flight, each one a thin slice ([roadmap.md](roadmap.md)) |
| Spike | Don Wells, ["Create spike solutions"](http://www.extremeprogramming.org/rules/spike.html) (Extreme Programming rules) | Throwaway code that answers one question before the plan depends on the answer: S1–S9 |
| Definition of done | Ken Schwaber and Jeff Sutherland, [*The Scrum Guide*](https://scrumguides.org/scrum-guide.html) (2020), "Commitment: Definition of Done" | A shared checklist for when work counts as done; "write about it" is on this one |
| Planning fallacy and the outside view | Bent Flyvbjerg, ["From Nobel Prize to Project Management: Getting Risks Right"](https://arxiv.org/abs/1302.3642) (2006) | Forecast from how comparable work went, not from the plan; the roadmap rescales its estimates after PR 3 |

## Platform background: Durable Objects

| Concept | Canonical source | Why it is here |
|---|---|---|
| Input and output gates | Kenton Varda, ["Durable Objects: Easy, Fast, Correct — Choose three"](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/) (2021) | Why single-threaded DO code is correct without explicit locks |
| SQLite storage and point-in-time recovery | Kenton Varda, ["Zero-latency SQLite storage in every Durable Object"](https://blog.cloudflare.com/sqlite-in-durable-objects/) (2024) | The storage model the lab is billed for, and the recovery the Migration Lab demonstrates |
| WebSocket Hibernation | Cloudflare, ["Use WebSockets"](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | An idle object leaves memory while its sockets stay connected, billable duration stops, and pings are answered without waking it: why every lab room uses the Hibernation API ([lab.md](lab.md)) |
| DO design rules | Cloudflare, ["Rules of Durable Objects"](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) | One object per unit of coordination, idempotent alarms, cleanup with `deleteAll()`: read before the first demo |

## Patterns and further reading

This file is the further reading for every other doc. Three sources to start with, in this order:

- Michael Nygard, *Release It!*, 2nd ed., ch. 5: the vocabulary behind the site's shape.
- Martin Kleppmann, *Designing Data-Intensive Applications*, Part III introduction: the vocabulary behind data ownership.
- Malte Ubl, "Design Docs at Google": the habit behind every "Alternatives considered" section.
