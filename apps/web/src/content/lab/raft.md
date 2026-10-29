---
title: Break a Raft cluster
summary: Five servers keep one log with Raft. Crash them, split the network and lose messages in your browser, and watch every safety property hold.
lifecycle: live
runtime:
  kind: browser
decisions: ['0020']
firewall_reviewed: 2026-10-29
---

## What Raft promises

Raft keeps one log on several servers, so that they act as one machine that stays up when some of them fail. One server leads. It takes every write, copies it to the others, and calls it committed once a majority holds it. If the leader goes quiet, a follower whose timer runs out asks for votes, and a server that wins a majority leads the next term.

What it guarantees is safety, whatever the network does: two servers never commit different entries at the same place in the log, and a committed entry is never lost. While a majority can talk to each other, it also makes progress. A minority never can, by design.

## Three things to try

**Cut off the leader.** Press Run, then Cut off the leader. The others stop hearing its heartbeats; one of them times out, wins a new term and leads. The old leader still thinks it leads. Send a write: it takes it, but can never commit it, since it cannot reach a majority.

**Split 2 and 3.** The leader and one neighbour end up on the small side. Writes sent to it pile up uncommitted, while the three on the other side elect a leader of their own and commit theirs.

**Heal the network.** The old leader hears the newer term and steps down. Its uncommitted entries conflict with the new leader's log, so they are dropped and replaced. The event log names each one. That is the rule doing its job: those entries were never promised to anyone.

Then try crashing two servers at once, or three, and losing a third of all messages.

## What the colors and shapes mean

Each server's ring is its election timer: when it closes, the server asks for votes. The leader's ring stays full. A hollow dot on the wire asks for a vote; a filled dot grants one. A filled square carries log entries; an outlined square is a heartbeat with none. When the network is cut, a dashed outline fences off the smaller side, and no message crosses it. In each log, a cell is one entry with its term under it, filled once committed.

## Credits

The algorithm is Diego Ongaro and John Ousterhout's, from [In Search of an Understandable Consensus Algorithm](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro) (USENIX ATC 2014). The picture of five servers on a circle comes from Ongaro's RaftScope, the visualization on the Raft website. This demo shares none of its code.

## What it costs

Nothing to run. Every file is static, and your browser runs the simulation.
