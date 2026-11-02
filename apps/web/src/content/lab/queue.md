---
title: Crash the workers behind a queue
summary: A broker hands a made-up bakery's orders to three workers. Crash one mid-order and choose when they acknowledge, to see work lost, done twice or done once.
lifecycle: live
runtime:
  kind: browser
decisions: ['0026']
firewall_reviewed: 2026-11-02
---

## What a queue promises

A broker holds the bakery's online orders until a worker takes one, prints its oven ticket and says it is done. That last step, the acknowledgement, is the whole contract. Until the broker hears it, the order is still the broker's, and if the worker's connection drops, the broker gives the order to another worker. So a queue delivers at least once. It cannot promise exactly once: a worker can crash after it printed the ticket and before its acknowledgement left, and then the order is printed again.

Exactly once is something the worker builds on top. It keeps a record of every order it has printed, keyed by the order's id, and writes the record in the same step as the ticket. A second delivery of the same order finds its id and prints nothing. That record is an idempotency key. This simulation writes the record and the ticket together, in one atomic step. A real printer can't join a database transaction, so real systems get as close as they can by making the action itself safe to repeat.

## Three things to try

**Crash a worker between the ticket and the acknowledgement.** The first run does it: worker 2 crashes at 2.4 s, order 18 goes back to the head of the queue, and worker 1 prints it a second time. Turn on the idempotency key, start over and run it. The same crash at the same moment prints order 18 once; the second delivery is skipped.

**Acknowledge before the work.** Switch to acknowledging on delivery, then crash a worker. The orders it held are gone, never printed. Acknowledging first trades duplicates for losses: at most once instead of at least once.

**Publish a poison order, then stop taking orders.** It fails every time. With requeue, it comes straight back and keeps a worker busy forever, and the queue never drains. Choose dead-lettering, start over, and do both again: it is retried after 200, 400 and 800 ms, then set aside after the fourth try, and the queue drains.

Then choose ten orders of prefetch and slow one worker down: it sits on nine orders it cannot reach. Choose one, start over and slow it again, and it holds only the order it works on. And restart worker 2, then try a rush: three workers print about 9.7 orders a second, so at 14 a second the queue grows, and each order's wait with it.

## How to read it

Orders enter on the left and wait in the queue. Each worker's row holds the orders it has taken, up to the prefetch it had when it took them; the lit dot is the one it's working on. A ticket at the right is filled once printed, and an order printed twice carries a second ring. The dead-letter queue holds orders set aside after their last try. The three checks under the picture run after every event.

## Credits

The model is the acknowledgement, prefetch and dead-lettering of the AMQP 0-9-1 protocol, described here without any one broker's details. Idempotency keys as a worker's own record: Brandur Leach, [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys) (2017). The queue's growth under load is Little's law: the number of orders waiting is the rate they arrive times how long each waits (John D. C. Little, 1961).

## What it costs

Nothing to run. Every file is static, and your browser runs the simulation.
