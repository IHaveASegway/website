---
title: Break a Raft cluster
summary: Raft keeps five simulated servers on one log, the ordered list of writes. Crash them, split the network and lose messages, and watch every safety property hold.
lifecycle: live
runtime:
  kind: browser
decisions: ['0020']
firewall_reviewed: 2026-11-02
---

## What Raft promises

Raft keeps one log on several servers, so that they act as one machine that stays up when some of them fail. One server leads. It takes every write, copies it to the others, and calls it committed once a majority holds it. Time is split into numbered terms, and each term has at most one leader. If the leader goes quiet, a follower whose timer runs out asks for votes, and a server that wins a majority leads the next term.

What it guarantees is safety, whatever the network does: two servers never commit different entries at the same place in the log, and a committed entry is never lost. While a majority can talk to each other, it also makes progress. A minority never can, by design.

## Three things to try

Left alone, the run you land on crashes its leader to show an election, then starts over. Any press except Start over ends that, and the cluster is yours.

**Cut off the leader.** With the run going, press Cut off the leader. The others stop hearing its heartbeats; one of them times out, wins a new term and leads. The old leader still thinks it leads. Send a write: the old leader takes it, but can never commit it, since it cannot reach a majority.

**Split two servers from three.** The leader and one neighbor end up on the small side. Writes sent to it pile up uncommitted, while the three on the other side elect a leader of their own.

**Heal the network.** The old leader hears the newer term and steps down. Its uncommitted entries stay until the new leader sends one of its own: send a write, and they are dropped and replaced. The “What happened” list says how many, and marks a write as gone once a different entry is committed in its place. That's correct: those entries were never committed.

Then try crashing two servers at once, or three, and losing a third of all messages.

## How to read it

Each server's ring is its election timer: when it closes, the server asks for votes. The leader's ring stays full. A hollow dot on the wire asks for a vote; a filled dot grants one, and a gray outline refuses one. A filled square carries log entries; an outlined square is a heartbeat with none; a small gray dot is a follower's answer to either. When the network is split, a dashed outline fences off the smaller side, and no message crosses it. In each log, a dot is one entry with its term under it, filled once committed. The five safety properties, from Figure 3 of the paper, are Election Safety, Leader Append-Only, Log Matching, Leader Completeness and State Machine Safety.

## Credits

The algorithm is Diego Ongaro and John Ousterhout's, from [In Search of an Understandable Consensus Algorithm](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro) (USENIX ATC 2014). The picture of five servers on a circle comes from Ongaro's RaftScope, the visualization on the Raft website. This lab shares none of its code.

## What it costs

It costs me nothing to run: the page is just static files, and your browser runs the simulation.
