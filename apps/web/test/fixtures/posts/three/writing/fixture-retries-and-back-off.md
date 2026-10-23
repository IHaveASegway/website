---
title: Retries & back-off, or why "later" beats "now"
summary: Jitter spreads retries out, so p99 < 2 s holds under load. A test fixture, never published.
published: 2026-10-18
updated: 2026-10-21
tags: [platform]
kind: pattern
firewall_reviewed: 2026-10-21
---

A pattern in three steps:

1. Wait before retrying, and wait longer each time.
2. Add jitter, so clients that failed together do not retry together.
3. Stop after a budget, and say so.

Its title holds `&` and quotation marks, and its summary a `<`, so every output that carries them
shows whether they were escaped.
