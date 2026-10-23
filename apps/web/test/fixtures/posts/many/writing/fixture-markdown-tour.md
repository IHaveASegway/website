---
title: A tour of the Markdown a post may use
summary: Tables, footnotes, nested lists, quotations and code, as the prose layout draws them. A test fixture, never published.
published: 2026-10-15
tags: [writing]
kind: essay
firewall_reviewed: 2026-10-15
---

Every construct the prose layout styles appears here once, so the checks every page meets see each
of them: axe, the policy, the glyph check and the 320 px reflow.

A heading underlined instead of hashed
--------------------------------------

The underline makes an h2, as two hashes do. A post never has an h1 of its own: its title is the
page's one.

### A table

| Budget           | Limit    | Measured |
| ---------------- | -------- | -------- |
| Eager JavaScript | 5,000 B  | 624 B    |
| CSS              | 15,000 B | 6,238 B  |
| Preloaded fonts  | 70,000 B | 64,140 B |

### A wide table

Five columns, two of them holding commit ids, which have nowhere to break: at 320 px the cells must
wrap inside the column, or the table would push the page sideways.

| Version  | Commit                                   | Deployment message                            | Day        | Result   |
| -------- | ---------------------------------------- | --------------------------------------------- | ---------- | -------- |
| 1f0b6c2d | 5a00328d0c1b8d4e9f2a7c6b3d1e0f9a8b7c6d5e | main@5a00328d0c1b8d4e9f2a7c6b3d1e0f9a8b7c6d5e | 2026-10-23 | promoted |
| 7c3e9a01 | 0c1b8d4e9f2a7c6b3d1e0f9a8b7c6d5e5a00328d | main@0c1b8d4e9f2a7c6b3d1e0f9a8b7c6d5e5a00328d | 2026-10-24 | promoted |

### Footnotes

The measure is set in em rather than ch.[^measure] A second reference shares the same note.[^measure]
A third goes to its own.[^drafts]

[^measure]: The digit zero is wide in this face, so a 68ch column held 99 characters a line.

[^drafts]: A draft is noindex, and nothing lists it.

### Lists inside lists

1. Build once.
   - Scan what was built.
   - Deploy those bytes, and nothing rebuilt.
2. Check production.
   1. Compare the served HTML with the build.
   2. Roll back on a mismatch.

> A quotation with **strong** and _emphasised_ words, `inline code`, and a
> [link to the index](/writing/).

```go
// Full jitter: wait a random time up to the cap.
func backoff(attempt int) time.Duration {
	limit := time.Duration(1<<attempt) * 100 * time.Millisecond
	return time.Duration(rand.Int64N(int64(limit)))
}
```

---

The line above is a thematic break, and this sentence ends the tour.
