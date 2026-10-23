import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

// The pre-paint theme script. Base.astro inlines this exact file, and its hash is computed here
// from the same bytes, so an edit can never leave a stale hash behind (security.md, "The theme
// script, from PR 3"). Astro does not hash is:inline scripts itself.
const themeScript = readFileSync(new URL('./src/scripts/theme.js', import.meta.url), 'utf8');
const themeHash = `sha256-${createHash('sha256').update(themeScript).digest('base64')}`;

/** A self-hosted face cut by scripts/fonts/build.sh, preloaded on every page by Base.astro. */
const font = (name, cssVariable, file, variant) => ({
  provider: fontProviders.local(),
  name,
  cssVariable,
  // Astro's own fallback is one face fitted to Arial at full width; the condensed name needs one
  // family per local font, fitted per width. src/styles/font-fallbacks.css has them, and
  // tokens.css puts them behind these faces.
  fallbacks: [],
  optimizedFallbacks: false,
  options: { variants: [{ src: [`./src/assets/fonts/${file}`], style: 'normal', ...variant }] },
});

// The sitemap lists indexable pages only. A draft in a pull request preview is noindex
// (lib/posts.ts), and so is anything else that says so; the filter reads each built page's own
// robots tag rather than keeping a second list. It runs once the pages are written, in outDir.
let outDir;
const recordOutDir = {
  name: 'record-out-dir',
  hooks: { 'astro:config:done': ({ config }) => (outDir = config.outDir) },
};
const indexable = (page) => {
  const file = new URL(`.${new URL(page).pathname}index.html`, outDir);
  return (
    !existsSync(file) || !/<meta name="robots" content="noindex">/.test(readFileSync(file, 'utf8'))
  );
};

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
  integrations: [recordOutDir, sitemap({ filter: indexable })],
  // Spike S9 (roadmap.md): the Fonts API's local provider passes the width range through to
  // font-stretch, writes both preload links, serves the files from /_astro/fonts/ and hashes the
  // <style> it emits into style-src. So it serves the faces, with Astro's fallbacks off (above).
  fonts: [
    font('Instrument Sans', '--font-instrument-sans', 'instrument-sans-latin.woff2', {
      weight: '400 700',
      stretch: '75% 100%',
    }),
    font('JetBrains Mono', '--font-jetbrains-mono', 'jetbrains-mono-c.woff2', {
      weight: '400 500',
    }),
  ],
  // No code blocks yet. Shiki's default highlighting writes inline styles the policy would refuse;
  // Expressive Code arrives with the first post that needs it (stack.md).
  markdown: { syntaxHighlight: false },
  // The page policy, delivered in a <meta> tag (security.md, "Headers and Content Security Policy").
  // Astro adds script-src and style-src with 'self' and a hash for each inline script or style it
  // emits. frame-ancestors cannot live in <meta>, so public/_headers sends it.
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
      scriptDirective: { hashes: [themeHash] },
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // No asset becomes a data: URI, which img-src and font-src 'self' would refuse.
    build: { assetsInlineLimit: 0 },
  },
});
