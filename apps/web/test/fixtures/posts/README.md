# Post fixtures

Test-only posts. `scripts/build-fixtures.mjs` builds the site from one of these sets, through
`POST_FIXTURES`, into `apps/web/.fixtures/`; `test/writing.test.ts`, the extra Vitest projects in
`vitest.config.ts` and `pnpm e2e:writing` read those builds. A real build never reads this folder,
and `test/writing.test.ts` fails if the phrase every fixture summary carries, "A test fixture, never
published", or a `fixture-` slug ever reaches `dist/` or `dist-preview/`.

Every slug here starts with `fixture-`, and no real post's may: the prefix is reserved, so a real
post can never collide with a fixture.

- `none/`: two drafts, an essay and a note, and nothing published. A draft never counts, so
  production builds nothing for Writing, and with drafts included only the two draft pages build.
- `one/`: one essay published, and two drafts, one of which links back to the essay: Writing
  renders at exactly one post, with `/writing/` but no `/notes/`, since no note is published.
- `many/`: five posts published, three essays and two notes, and a draft note: Home lists the
  three latest, and the indexes and the feed list all five. `fixture-markdown-tour` uses every construct the prose
  layout styles: a table, a wide one whose commit ids cannot break (so the cell rule is exercised
  at 320 px), footnotes, nested lists, a quotation, code and a heading underlined instead of
  hashed.

The text uses only characters the site's font subsets carry, so the glyph checks pass on it, and
one title holds `&` and `"`, and one summary `<`, so escaping is checked in every output.
