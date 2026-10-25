import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import { commit, withBuildHeader } from './src/lib/build.mjs';
import { policyFor, withPagePolicies } from './src/lib/csp.mjs';
import { isNoindex } from './src/lib/noindex.mjs';

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

// Which command Astro is running, fixed into the build as a constant. lib/content.ts includes
// drafts in astro dev from this, not from NODE_ENV, which any environment can set: a build then
// includes drafts only with DRAFTS=include (lib/posts.ts, draftsIncluded).
const recordCommand = {
  name: 'record-command',
  hooks: {
    'astro:config:setup': ({ command, updateConfig }) =>
      updateConfig({ vite: { define: { __ASTRO_COMMAND__: JSON.stringify(command) } } }),
  },
};

// Which commit a build came from is a machine's question: once the build is written, its _headers
// gains X-Build under the "/*" rule, so every response names the commit for the deploy smoke and
// no page carries it (src/lib/build.mjs).
const buildHeader = {
  name: 'build-header',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const file = new URL('_headers', dir);
      writeFileSync(file, withBuildHeader(readFileSync(file, 'utf8'), commit));
    },
  },
};

// The page policy is a header (security.md, "Headers and Content Security Policy"; ADR 0018). Once
// the pages are written, each one's policy is read from its own inline code, a hash for each
// script and style it holds, and written into the build's _headers: the 404's on the "/*" rule,
// which every response matches, and a rule of its own for a page whose policy differs
// (src/lib/csp.mjs). The theme script in <head> is covered with the rest, and no <meta> is written.
const pagePolicy = {
  name: 'page-policy',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const root = fileURLToPath(dir);
      const walk = (at) =>
        readdirSync(at).flatMap((name) => {
          const path = join(at, name);
          return statSync(path).isDirectory() ? walk(path) : [path];
        });
      const policies = new Map(
        walk(root)
          .filter((file) => file.endsWith('.html'))
          .map((file) => {
            const rel = relative(root, file).split(sep).join('/');
            // Pages are <path>/index.html (ADR 0005) and the 404 is at the root. Any other .html
            // would be served at a path no rule here names, under the 404's policy.
            if (rel !== '404.html' && rel !== 'index.html' && !rel.endsWith('/index.html'))
              throw new Error(`page-policy: ${rel} is not a page this step knows how to serve`);
            const path =
              rel === '404.html' ? '/404.html' : `/${rel.slice(0, -'index.html'.length)}`;
            return [path, policyFor(readFileSync(file, 'utf8'), path)];
          }),
      );
      const file = new URL('_headers', dir);
      writeFileSync(file, withPagePolicies(readFileSync(file, 'utf8'), policies));
    },
  },
};

// The sitemap lists indexable pages only. A draft in a pull request preview is noindex
// (lib/posts.ts), and so is anything else that says so; the filter reads each built page's own
// robots tag (lib/noindex.mjs) rather than keeping a second list. It runs once the pages are
// written, in outDir.
let outDir;
const recordOutDir = {
  name: 'record-out-dir',
  hooks: { 'astro:config:done': ({ config }) => (outDir = config.outDir) },
};
const indexable = (page) => {
  const file = new URL(`.${new URL(page).pathname}index.html`, outDir);
  return !existsSync(file) || !isNoindex(readFileSync(file, 'utf8'));
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
  integrations: [
    recordCommand,
    recordOutDir,
    buildHeader,
    pagePolicy,
    sitemap({ filter: indexable }),
  ],
  // Spike S9 (roadmap.md): the Fonts API's local provider passes the width range through to
  // font-stretch, writes both preload links, serves the files from /_astro/fonts/ and emits a
  // <style> with the faces, which pagePolicy hashes into style-src (above). So it serves the faces,
  // with Astro's fallbacks off.
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
  markdown: {
    syntaxHighlight: false,
    // Sätteri, Astro's default processor, configured only to draw a footnote's way back as "↑":
    // its default "↩" is in neither font subset, so every footnote would fall back to a system
    // font (the glyph check). Everything else is the processor's default.
    processor: satteri({ features: { gfm: { footnotes: { backContent: '↑' } } } }),
  },
  // No security.csp: Astro's policy is a <meta>, which covers only what follows it and cannot
  // carry frame-ancestors. The page policy is the header pagePolicy writes (above), and a <meta>
  // beside it would be a second owner of the same directives.
  vite: {
    plugins: [tailwindcss()],
    // No asset becomes a data: URI, which img-src and font-src 'self' would refuse.
    build: { assetsInlineLimit: 0 },
  },
});
