---
title: Stampede a cache
summary: A made-up bakery’s menu expires while 300 readers a second are on its site. Coalesce, serve stale, refresh early or jitter, and watch the database.
lifecycle: live
runtime:
  kind: browser
decisions: ['0026']
firewall_reviewed: 2026-11-02
---

## What a cache promises

A cache keeps a copy of what the database would say, close to the reader, for a while. Most of the bakery's 120 pages are cheap, and one, the menu, is asked for far more than the rest and takes 420 ms to build. A cache entry carries an expiry time. Until it passes, readers get the copy in a millisecond. When it passes, the next reader goes to the database, and so does every reader who arrives before the new copy is back.

That last part is the stampede. At 300 reads a second, an expired menu sends dozens of readers to the database at once. Its eight connections fill, the rest wait in line, and readers who wait a second give up. A fetch still in line when its last reader leaves is dropped; one already running finishes.

## Three things to try

**Let the menu expire.** The first run does it: the entry expires at 3.0 s, the database has 23 fetches of the menu in flight at once, and two readers time out. Turn on coalescing and serving stale, and start over. One reader fetches; the others wait for that fetch or take the old copy, and nobody times out.

**Flush every node at the morning rush.** Choose the morning's 600 reads a second and flush with nothing turned on. Every page misses at once: within a second more than 250 fetches wait for the database's eight connections, and for about three seconds readers give up. The pages fetched again together expire together eight seconds later, so the overload comes back in waves, about every ten seconds, and does not die out. Turn on jitter and early refresh before you flush, and the expiries spread out: no second wave forms.

**Lose a node.** The pages live on four cache nodes. With modulo placement, losing one moves about three quarters of the pages to a new node, empty, so they all miss at once. On the hash circle, which is consistent hashing, only the lost node's quarter moves.

Then write to the menu with invalidation off, and count the readers who get the old version until it expires.

## How to read it

Readers enter on the left and fan in to the four cache nodes. A node's small dots are the pages it holds, and their shape says fresh, expired, missing or being fetched. The database's eight dots are its connections; a lit dot is a fetch running, and the count beside them is the line waiting. Under the picture, each moment's reads are drawn by what they got: the cache, a stale copy, a fresh fetch, or a timeout, and a hollow bar is reads still waiting. The three checks under it watch the whole run. With serving stale on, a page can be up to 4 s past its expiry.

## Credits

Early refresh is the XFetch rule from Andrea Vattani, Flavio Chierichetti and Keegan Lowenstein, [Optimal Probabilistic Cache Stampede Prevention](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf) (VLDB 2015). Coalescing stands in for the leases in Rajesh Nishtala et al., [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala) (NSDI 2013). Serving stale while refreshing is [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861). The hash circle is consistent hashing (David Karger et al., STOC 1997).

## What it costs

Nothing to run. Every file is static, and your browser runs the simulation.
