import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ihaveasegway.com',
  // Trailing slashes everywhere, written as <path>/index.html (ADR 0005).
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // External stylesheets only: an inlined <style> would need a hash in the policy, and
    // /_astro/ files are cached for a year by content hash (delivery.md, "Config as code").
    inlineStylesheets: 'never',
  },
  integrations: [sitemap()],
  // No code blocks yet. Shiki's default highlighting writes inline styles the policy would refuse;
  // Expressive Code arrives with the first post that needs it (stack.md).
  markdown: { syntaxHighlight: false },
  // The page policy, delivered in a <meta> tag (security.md, "Headers and Content Security Policy").
  // Astro adds script-src and style-src with 'self' and a hash for each inline script or style it
  // emits; PR 2 emits none. frame-ancestors cannot live in <meta>, so public/_headers sends it.
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
