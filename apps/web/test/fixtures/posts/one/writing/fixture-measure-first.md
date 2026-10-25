---
title: Measure first, then build the cache
summary: How a profile changed the plan before any code was written. A test fixture, never published.
published: 2026-10-20
tags: [architecture, testing]
kind: essay
firewall_reviewed: 2026-10-20
---

A short essay that only the tests read. It holds a paragraph, a heading, a list, a quotation and a
block of code, so the prose layout draws each of them at least once.

## What the profile showed

Most of the time went to one call that ran once per file. A cache in front of it would have hidden
the cost instead of removing it.

- The slow call ran 4,096 times for 4,096 files.
- Batching it made the run take 41.0 s instead of 119.5 s.
- No cache was built.

> Find where the time goes before changing anything.

### The command

```text
$ time ./scan --all
real    41.0s
```
