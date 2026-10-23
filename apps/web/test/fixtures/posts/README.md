# Post fixtures

Test-only posts. `scripts/build-fixtures.mjs` builds the site from one of these sets, through
`POST_FIXTURES`, into `apps/web/.fixtures/`; `test/writing.test.ts` and `pnpm e2e:writing` read those
builds. A real build never reads this folder, and `test/writing.test.ts` fails if the phrase every
fixture summary carries, "A test fixture, never published", ever reaches `dist/`.

- `two/`: one essay and one note published, and one draft essay. Below the three-post rule, so
  Writing must build nothing, and the draft must not count.
- `three/`: two essays and one note published, and one draft note. Writing renders; the draft is
  listed nowhere, and builds a page only where drafts are included.

The text uses only characters the site's font subsets carry, so the glyph check passes on it, and
one title holds `&` and `"`, and one summary `<`, so escaping is checked in every output.
