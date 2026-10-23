// Site constants. Pure, so build-time code and unit tests share them.

/** The one public origin (ADR 0005). astro.config.mjs's `site` says the same. */
export const ORIGIN = 'https://ihaveasegway.com';

/** The contact address (Q2). profile.json has no email field on purpose, so it lives here. */
export const CONTACT_EMAIL = 'hello@ihaveasegway.com';

/** The site's own name in its other spelling, for WebSite JSON-LD (content.md). It is also the
 *  GitHub handle, so lib/jsonld.ts writes it only once the GitHub profile's check is recorded. */
export const ALTERNATE_NAME = 'IHaveASegway';
