---
title: Stampede a cache
summary: Hundreds of readers ask for the bakery's menu when its cache entry expires. Coalesce, serve stale, refresh early or jitter, and watch the database.
lifecycle: live
runtime:
  kind: browser
decisions: ['0026']
firewall_reviewed: 1970-01-01 # NOT A REVIEW: no person has read this entry. Set the UTC day of the read; the review stamp in verify refuses this value until then.
---

## What a cache promises

A cache keeps a copy of what the database would say, close to the reader, for a while. Most of the bakery's 120 pages are cheap, and one, the menu, is asked for far more than the rest and takes 420 ms to build. A cache entry carries an expiry time. Until it passes, readers get the copy in a millisecond. When it passes, the next reader goes to the database, and so does every reader who arrives before the new copy is back.

That last part is the stampede. At 300 reads a second, an expired menu sends dozens of readers to the database at once. Its eight connections fill, the rest wait in line, and readers who wait a second give up, while the fetches they started still run.

## Three things to try

**Let the menu expire.** The first run does it: the entry expires at 3.0 s, the database fetches the menu 23 times at once, and two readers time out. Turn on coalescing and serving stale, and start over. One reader fetches; the others wait for that fetch or take the old copy, and nobody times out.

**Flush every node at the morning rush.** With nothing turned on, every page expires together eight seconds later, and at 600 reads a second the database falls behind and stays behind, long after the burst: an overload that outlives its cause. Turn on jitter and early refresh, and the expiries spread out.

**Lose a node.** The pages live on four cache nodes. With modulo placement, losing one moves about three quarters of the pages to a new node, empty, so they all miss at once. On the hash circle, only the lost node's quarter moves.

Then write to the menu with invalidation off, and count the readers who get the old version until it expires.

## What the lines and lamps mean

Readers enter on the left and fan in to the four cache nodes. The database's eight lamps are its connections; a lit lamp is a fetch running, and the count beside them is the line waiting. Under the picture, each moment's reads are drawn by what they got: the cache, a stale copy, a fresh fetch, or a timeout. The three properties under it are checked after every event.

## Credits

Early refresh is the XFetch rule from Andrea Vattani, Flavio Chierichetti and Keegan Lowenstein, [Optimal Probabilistic Cache Stampede Prevention](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf) (VLDB 2015). Coalescing stands in for the leases in Rajesh Nishtala et al., [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala) (NSDI 2013). Serving stale while refreshing is [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861). The hash circle is consistent hashing (David Karger et al., STOC 1997). An overload that outlives its cause is a metastable failure (Nathan Bronson et al., [HotOS 2021](https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf)).

## What it costs

Nothing to run. Every file is static, and your browser runs the simulation.
