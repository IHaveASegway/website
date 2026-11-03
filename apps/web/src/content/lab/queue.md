---
title: Crash the workers behind a queue
summary: Three worker programs take a made-up bakery’s orders from a queue. Crash one and choose when they say they’re done, to see work lost, done twice or done once.
lifecycle: live
runtime:
  kind: browser
decisions: ['0026']
firewall_reviewed: 2026-11-02
---

## What a queue promises

A broker holds the bakery's online orders until a worker takes one, prints its oven ticket and says it is done. That last step, the acknowledgement, is the whole contract. Until the broker hears it, the order is still the broker's, and if the worker's connection drops, the broker gives the order to another worker. So a queue delivers at least once. It cannot promise exactly once: a worker can crash after it printed the ticket and before its acknowledgement left, and then the order is printed again.

Exactly once is something the worker builds on top. It keeps a record of every order it has printed, keyed by the order's id, and writes the record in the same step as the ticket. A second delivery of the same order finds its id and prints nothing. The order's id is the idempotency key, and the record is how the worker checks it. This simulation writes the record and the ticket together, in one atomic step. A real printer can't join a database transaction, so real systems get as close as they can by making the action itself safe to repeat.

## Three things to try

**Crash a worker between the ticket and the acknowledgement.** The run the page opens on does it: worker 2 crashes at 2.4 s, order 18 goes back to the head of the queue, and worker 1 prints it a second time. Turn on the idempotency key, and the run starts over. The same crash at the same moment prints order 18 once; the second delivery is skipped.

**Acknowledge before the work.** Switch to acknowledging before the work, then crash a worker. The orders it held are gone, never printed. Acknowledging first trades duplicates for losses: at most once instead of at least once.

**Send a poison order, then stop taking orders.** It fails every time. With requeue, it comes straight back and keeps a worker busy forever, and the queue never drains. Choose dead-lettering, start over, and do both again: it is retried after 200, 400 and 800 ms, then set aside after the fourth try, and the queue drains.

Then set prefetch, the orders each worker may hold, to ten and slow one worker down: it holds nine orders it won't get to for a while, and no other worker can take them. Choose one, start over and slow it again, and it holds only the order it works on. And restart worker 2, then try a rush: three workers print about 9.7 orders a second, so at 14 a second the queue grows, and each order's wait with it.

## How to read it

Orders enter on the left and wait in the queue. Each worker's row holds the orders it has taken, up to the prefetch it had when it took them; the lit dot is the one it's working on. A ticket at the right is filled once printed, and an order printed twice carries a second ring. The dead-letter queue holds orders set aside after their last try. The three checks under the picture watch the whole run.

## Credits

The model is the acknowledgement, prefetch and dead-lettering of the AMQP 0-9-1 protocol, described here without any one broker's details. Idempotency keys: Brandur Leach, [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys) (2017), where an API server keeps them for its clients; the worker here keeps them for itself. The queue grows under load because orders arrive faster than workers print them. Little's law ties the line to the wait: on average, the number of orders waiting is the rate they arrive times how long each waits (John D. C. Little, 1961).

## What it costs

It costs me nothing to run: the page is just static files, and your browser runs the simulation.
