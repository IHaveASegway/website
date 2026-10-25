# Content

The site's content, as data ([content.md](../../../../docs/content.md), "Content model"):
`profile.json` now, and `writing/` and `notes/` once posts exist. Components own presentation, so
a post carries no class names and no raw HTML.

Tailwind does not read this folder (`@source not '../content'` in `src/styles/global.css`), so the
words of a post, or of a draft, never change the stylesheet that production serves. This file is
the canary for that rule: the line below names utilities on purpose, and `test/css-classes.test.ts`
fails if any of them reaches the built stylesheet.

Canary: relative absolute grid underline
