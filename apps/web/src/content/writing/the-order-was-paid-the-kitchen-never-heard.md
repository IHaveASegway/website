---
title: The order was paid. The kitchen never heard.
summary: Six parts of a made-up bakery have to hear about a paid order, and none can share a transaction with it. This is how each hears once.
published: 2026-11-27
kind: pattern
draft: true
tags:
  - architecture
  - durable-objects
  - cloudflare
firewall_reviewed: 2026-11-27
---

Two cardamom buns and a country loaf, paid by test card, at [Proof of Concept Bakery](https://bakery.ihaveasegway.com/),
a made-up bakery with working software.

Six other parts of the bakery have to hear about that payment. The day's schedule turns a held slot into a reservation.
The kitchen moves the card to confirmed. The CRM and the customer's record update. The inbox writes the receipt.
Dispatch confirms the delivery's stop.

Each of those is a Durable Object with storage of its own, and no transaction spans two objects. So the order can't
record the payment and move the kitchen's card in one step. It writes its own state and then tells the others. The
trouble is all in the word "then".

## Two steps, and the gap between them

The order's write and the send to the queue are two operations on two systems, and there's a moment between them
whichever comes first.

Send first and fail before the write, and the board shows a paid card for an unpaid order. Write first and fail before
the send, and the kitchen never hears.

## Store the message with the change

The bakery writes first, and treats the send as something that may happen more than once.

In one transaction, the order appends the event, copies it into an outbox table, writes its new state and records the
command's key. That's the transactional outbox pattern. The message is stored with the change, so it exists exactly
when the change does.

After the commit, the visitor already has their answer. The object then sends up to 100 outbox rows to the queue in one
batch and deletes the rows the queue accepted. A timer set 30 seconds out sends whatever is left.

The gap is still there. The only failure left in it is a duplicate: if the object stops after the queue took the batch
and before the delete, the rows go again.

## Delivered at least once, applied once

So every receiver remembers. Each one stores the id of an event it has applied, in the same write as the change. A
second delivery finds the id and changes nothing.

The bakery adds repeats of its own. Its consumer acknowledges a message only when every subscriber answered. When the
kitchen fails, the other five get the event again, and each one ignores it.

## Where the retrying stops

A queue that refuses everything shouldn't be retried forever. Each object may re-arm its timer 100 times a day.
At one try every 30 seconds, that's 50 minutes. Past that, the rows wait for the object's next command or for the
nightly wipe. A row waits. It is never dropped.

## Try the small version first

The [Queue Lab](/lab/queue/) shows the receiving half: crash a worker after it prints an oven ticket and before it says
so, and another worker prints the ticket again. It starts at the queue, though, so it can't show the first half, getting
the message there with the write that caused it. That's the part the bakery has to do for real.

The longer version, with the code, is on the bakery's own page:
[how the outbox is built](https://bakery.ihaveasegway.com/how-its-built/outbox/).
