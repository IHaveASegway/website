# ADR 0011: DNSSEC now; HSTS ramped; no preload yet

Status: Accepted · 2026-10-23 · Deciders: Joseph Peterson

## Context

The zone as found on 2026-10-22, from a read-only API session and the public RDAP record: DNSSEC off (`delegationSigned: false`), minimum TLS 1.0, Always Use HTTPS off, HSTS off, no DNS records, registrar lock on. The domain is registered with Cloudflare Registrar, where "all domains on Cloudflare Registrar use Cloudflare nameservers" ([FAQ](https://developers.cloudflare.com/registrar/faq/)). Cloudflare is both registrar and DNS host.

Three controls, and what each costs to undo:

- **DNSSEC** signs the zone's answers, so a validating resolver can reject forged ones (cache poisoning, on-path forgery). On Cloudflare Registrar it is one click, and the DS record reaches the .com registry through CDS/CDNSKEY records in 1–2 days ([Cloudflare](https://developers.cloudflare.com/registrar/get-started/enable-dnssec/)). The cost is in failure. If the DS record at the registry stops matching the zone's keys, every validating resolver answers SERVFAIL, and the domain, web and mail alike, disappears for everyone behind one. Undoing it means removing the DS record and waiting out its TTL at the parent: 86,400 s for .com, measured on 2026-10-22 against `a.gtld-servers.net`, plus the registrar's processing time.
- **HSTS** tells a browser to refuse plain HTTP for `max-age` seconds. The browser keeps the policy even after the header disappears, so a broken HTTPS setup inside that window makes the site unreachable for returning visitors "for the duration of the Max Age Header" ([Cloudflare](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)). With `includeSubDomains`, the same holds for every subdomain.
- **HSTS preload** compiles the domain into browsers, which also protects a visitor's first request. It needs a `max-age` of at least 31,536,000 s, `includeSubDomains` and `preload`. It "applies to all subdomains, including internal subdomains that are not publicly accessible", and "Domains can be removed, but it takes months for a change to reach users with a Chrome update" ([hstspreload.org](https://hstspreload.org/)). `.com` gets no protection from its TLD: Chrome preloads whole TLDs such as `.dev` and `.app` ([Eric Lawrence, 2017](https://textslashplain.com/2017/12/05/strict-transport-security-for-dev/)), and `.com` is not one of them.

Cloudflare's HSTS setting offers a max-age from 1 to 12 months in the dashboard. The API takes `max_age` in seconds, with no documented range ([API reference](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/edit/)). Twelve months meets the preload minimum. OWASP's example uses two years ([cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)), which this setting cannot express. All values as of 2026-10-22.

For a static portfolio with no logins, the threats these controls answer are modest. So is the cost, while the zone is empty and nothing depends on it. That is the cheapest moment to take the hard-to-reverse steps, and to take them slowly.

## Decision

1. **DNSSEC on now**, in PR 2's zone hardening, while the zone has no records and no traffic: Manage domains → the domain → Configuration → Enable DNSSEC. The weekly token-free audit checks that a DS record exists and that answers come back with `"AD": true` ([security.md](../security.md)).
2. **HSTS at the zone only.** Not in `_headers` and not in Worker code: one owner for every response through the zone.
3. **HSTS ramp.** Every step carries `includeSubDomains`, and each is held at least as long as its own max-age with no HTTPS fault before the next, which is hstspreload.org's rule.

   | Step | max-age | Hold before the next step | Set through |
   |---|---|---|---|
   | 1 | 300 s | Until PR 2's first production deploy passes prod-smoke | The API: the dashboard starts at 1 month |
   | 2 | 604,800 s (1 week) | 1 week | The API |
   | 3 | 2,592,000 s (1 month) | 1 month | Dashboard or API |
   | 4 | 31,536,000 s (12 months) | Stays | Dashboard or API |

   The API steps use a short-lived token with Zone Settings Edit, never the deploy token. If the API refuses values under a month, the ramp starts at step 3, which still bounds an early mistake to 30 days. The ramp takes about 5 weeks.
4. **No preload now.** Reconsider no earlier than 3 months after step 4, in a new ADR, because it is a one-way door.
5. **In the same PR, two-way, and recorded here because they ride together:** minimum TLS 1.2, TLS 1.3 on, Always Use HTTPS on.
6. **From Phase 4,** the weekly audit also checks that the zone's HSTS header reaches a `/lab/api/` response. If it does not, the lab's shared header function adds HSTS to Worker responses only.

## Alternatives considered

| Option | What it buys | Why not |
|---|---|---|
| DNSSEC off, as found | No risk of a signing fault | Forged answers stay undetectable to validating resolvers. With registrar and DNS host in one place, the classic failure (a stale DS record after moving DNS) has no second party to drift from, so the main risk is at exit, and exit is planned. |
| DNSSEC later, once the site has traffic | Nothing | The safest moment is while the zone is empty and nothing depends on it |
| HSTS at 12 months with `includeSubDomains` from day one, in `_headers` (an early research draft) | Full protection for returning visitors at once | An early mistake, such as a subdomain without HTTPS, would last a year for every returning visitor. `_headers` also misses Worker responses ([Cloudflare](https://developers.cloudflare.com/workers/static-assets/headers/)), which makes two owners. |
| HSTS in `_headers` or Worker code, at any max-age | Config in the repository | Two owners for one header, and `_headers` never applies to Worker responses |
| Preload now | Protects a visitor's first request | Near one-way for months, and it commits every future subdomain to HTTPS. First visits arrive through `https://` links (résumé, LinkedIn, GitHub) and the Always Use HTTPS redirect anyway. |
| No HSTS, only Always Use HTTPS | Nothing to undo | The first plain-HTTP request of every visit can still be intercepted and downgraded (SSL stripping) |

The trade, in quality attributes: availability risk (a signing fault, a stuck HSTS policy) against integrity (forged answers, downgraded connections). The ramp keeps the availability risk bounded at each step.

## Consequences

- From step 1, every subdomain must serve valid HTTPS for the max-age in force. Today that is `www`, which is proxied and covered by Cloudflare's edge certificate. A future subdomain (for example a lab hostname, the alternative in [ADR 0009](0009-lab-worker-same-origin.md)) is proxied with a certificate before it gets a record.
- Mail is unaffected by HSTS, which governs browsers only. Mail is affected by a DNSSEC fault, like everything else on the domain.
- A DNSSEC fault is slow to fix. Changes to DNSSEC go through a runbook ([operations.md](../operations.md)), and the weekly audit is the early warning.
- Leaving Cloudflare needs a DNSSEC hand-off first: disable signing and wait out the DS TTL, or roll keys with the new provider. That turns an exit into a plan of about a week ([security.md](../security.md), "Account continuity").
- The ramp's 5 weeks fit between PR 2 and PR 4 on the [roadmap](../roadmap.md).
- Patterns: defense in depth (DNSSEC, TLS and HSTS each cover a different hop), and a staged rollout of a setting that cannot be recalled, the same idea as a canary release. Sources are in [reading-list.md](../reading-list.md).

## Door

- **DNSSEC: near one-way in operation.** Turning it on is one click. A fault takes the domain off validating resolvers, and the fix waits on the parent's DS TTL (1 day for .com) plus the registrar's processing (1–2 days).
- **HSTS: each served max-age is one-way for its own duration.** A browser that saw it keeps it. That is why the ramp starts at 300 s.
- **Preload: near one-way.** Removal takes months to reach users.
- **Minimum TLS and Always Use HTTPS: two-way.**

## Revisit if

- Validation fails (the weekly `AD` check, SERVFAIL reports, DNSViz errors): fix the keys first, and if that cannot happen inside the DS TTL, disable DNSSEC through the runbook.
- A subdomain has to serve plain HTTP or cannot get a certificate: `includeSubDomains` is wrong for this zone, so stop the ramp before 12 months.
- Three months at 12 months with no HTTPS fault, and Joseph wants first-visit protection: write the preload ADR.
- DNS has to leave Cloudflare, which means a registrar transfer: plan the DS removal before anything else.
- The zone's HSTS header does not reach Worker responses: add it in the lab's header function, for those responses only.
