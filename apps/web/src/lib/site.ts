// Site constants. Pure, so build-time code and unit tests share them.

/** The one public origin (ADR 0005). astro.config.mjs's `site` says the same. */
export const ORIGIN = 'https://ihaveasegway.com';

/** The contact address (Q2). profile.json has no email field on purpose, so it lives here. */
export const CONTACT_EMAIL = 'hello@ihaveasegway.com';

/** The site's own name in its other spelling, for WebSite JSON-LD (content.md). It is also the
 *  GitHub handle, so lib/jsonld.ts writes it only once the GitHub profile's check is recorded. */
export const ALTERNATE_NAME = 'IHaveASegway';

/** The bakery: the made-up bakery the labs simulate, running as its own system on its own hostname
 *  (ADR 0032, ADR 0033). Home and /about/ link it where the bio names it. */
export const BAKERY_URL = 'https://bakery.ihaveasegway.com/';
/** The bio's name for it, the words that open it. */
export const BAKERY_NAME = 'Proof of Concept Bakery';
