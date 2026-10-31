---
title: The road closed. The stops didn't.
summary: Writing code by hand was how engineers provided. That route is closed, and the obligation to deliver is not. Notes on building the new route.
published: 2026-10-31
kind: essay
tags:
  - architecture
  - platform
  - testing
firewall_reviewed: 2026-10-31
---

Close a road in front of a route planner, and it does not cancel the deliveries. Every stop on the
list still needs its order. The solver drops the plan it had and builds a new one around the
closure. The new route is usually longer. Some stops get their order later than they used to. The
van drives it anyway, because the other choice is a van parked at a barrier, waiting for a road
that is not going to reopen.

That is where building software is now. The road most engineers delivered on is closed. The stops
are still on the list.

## The old route is closed

For as long as I have written software, providing looked the same. Take a ticket, read the code,
write the change by hand, get it reviewed, ship it. The value was in the hands, and so was the
living. A team that needed more software hired more hands. An engineer who wanted to be worth more
learned to type the right thing sooner.

That route is closing, and not because of a launch announcement. A plausible change now costs
minutes and cents. METR measures the length of task an AI model can finish on its own, and that
length has doubled about every seven months since 2019
([Kwa et al., 2025](https://arxiv.org/abs/2503.14499)). Teams have started publishing what the
other side looks like. One built roughly a million lines over five months without any manually
written source code
([InfoQ, 2026-02-21](https://www.infoq.com/news/2026/02/openai-harness-engineering-codex)).
Another works by two rules: "Code must not be written by humans" and "Code must not be reviewed by
humans" ([StrongDM, 2026-02-06](https://factory.strongdm.ai/)). Dan Shapiro calls the far end of
this road the dark factory: "a black box that turns specs into software"
([2026-01-23](https://www.danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/)).

Forcing the old approach now wastes the time it takes. Typing faster does not compete with a
machine that types for cents, and waiting for the old result on the old schedule produces nothing.

## The stops are still due

None of this moved the responsibility. People still need the software to work. The page at 3 a.m.
still goes to a person. A model can write the change, and it cannot answer for it. Linear's
guidelines for agents put it in one line: "An agent cannot be held accountable"
([Linear](https://linear.app/developers/aig)).

So the obligation is what it was: deliver software people can trust, at a cost the business can
carry, and be the one who answers for it. The mechanism is what is gone.

## The new route is a line, not a bench

The work moves from writing the change to building the line that writes it. I have been designing
one, and the parts that matter are not the agents. Agents are rented and replaced, and next year's
will be better. What compounds is the harness around them, and that part a team owns:

- **The question.** A request becomes a spec with worked examples before any agent starts. An agent
  will not be braver than its ticket, only more literal. A vague ticket gets the wrong thing built
  faster.
- **The walls.** Each agent runs under its own identity, with only the access its one job needs. A
  guardrail is something an agent cannot do, not something it is told not to do. A prompt is not a
  wall.
- **The checks.** Deterministic tests, plus scenarios the builders cannot read, so nothing grades
  its own work. A pass counts only for the exact version it tested.
- **The release.** Code ships switched off. Turning it on is a person's decision, one audience at a
  time. A deploy is not a release.
- **The record.** A decision is a fact in the system that owns it: the tracker, source control, the
  flag service. An agent's account of its own work is evidence, not the record.

Birgitta Böckeler calls this harness engineering: guides that steer an agent before it acts, and
sensors that check what it did
([martinfowler.com, 2026-04-02](https://martinfowler.com/articles/harness-engineering.html)). The
engineer's job becomes building and tuning those, and an old instinct has to be retrained. When I
catch myself fixing an agent's diff by hand, the better move is to write the check that would have
made it get the diff right.

**The lesson:** own the judgment, automate the volume.

## It gets thinner before it gets better

The new route does not deliver the old "enough" on day one, and nobody should promise that it will.

Economists have a name for this shape: the productivity J-curve. When a general-purpose technology
arrives, measured output dips while organizations build what the technology needs around it, and
rises later, once that investment pays off
([Brynjolfsson, Rock and Syverson, 2021](https://www.aeaweb.org/articles?id=10.1257/mac.20180386)).

The early evidence on AI and code looks like the bottom of that curve. In METR's randomized trial,
16 experienced open-source developers took 19% longer on 246 real tasks when they could use AI
tools, and afterwards still believed the tools had made them 20% faster
([METR, 2025-07-10](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)).
METR has since marked those results out of date, which is part of the point: the curve moves. DORA
estimated in 2024 that as AI adoption rose, delivery throughput fell 1.5% and delivery stability
fell 7.2%
([Google Cloud, 2024-10-22](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report)).
A year later the throughput relationship had turned positive. Stability had not: more changes
reached production, and teams without strong automated tests and fast feedback paid for them in
instability ([Google Cloud, 2025-09-23](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)).

That is the thin period, and the second finding says what carries a team through it: the checks,
not the agents. An honest plan names the dip before it arrives, so it reads as the plan working
rather than the plan failing. It also keeps two clocks apart. The line takes days to build. The
evidence that it works takes weeks of real use.

**The lesson:** expect the dip, and say so first.

## Stop waiting for the old result

The old scoreboard counted the old mechanism: tickets closed, pull requests merged, lines changed.
Those numbers inflate for free once a machine writes the code, and "percent of code written by AI"
measures nothing a user feels.

The scoreboard that survives counts outcomes: the time from a decision to a change people can use,
how often a change fails in production, the defects that escaped, and the human minutes behind each
accepted change, which has to fall. Judged that way, a factory's first promise is modest. It is not
that the team will be faster. It is that the team will notice if it is getting worse.

## Adjust, or the gap widens

The commitment to provide is still there. The old mechanism for doing it is not. Every month spent
waiting for the road to reopen is a month the route gets longer for whoever drives it later.

What adjusting looks like, in the order I would do it:

1. Write down what you know where an agent can read it: the invariants, the examples, the reasons
   behind the odd parts of the code. An agent works only from what is written.
2. Turn every miss into a check within a day, at the lowest level that would have caught it.
3. Pick one kind of reversible work and let the line run it end to end. Keep a person on every door
   that cannot be undone: data, money, access, anything a customer sees first.
4. Measure it with the new scoreboard, and say out loud that the first weeks will look thinner.

The road closed. The stops didn't. Plan the new route, and drive it.
