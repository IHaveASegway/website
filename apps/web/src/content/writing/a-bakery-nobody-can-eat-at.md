---
title: I built a bakery nobody can eat at
summary: My labs simulate a made-up bakery. I built its software for real, so you can place an order and see what happens behind it.
published: 2026-11-27
kind: essay
draft: true
tags:
  - architecture
  - cloudflare
  - durable-objects
firewall_reviewed: 2026-11-27
---

The labs on this site are simulations. Each one takes a single problem, like a cache stampede or a worker that crashes
halfway through an order, and lets you break it at a made-up bakery. A simulation shows what its rules say and no more.
It proves I understand the problem well enough to model it. It doesn't prove I can build and run the system the problem
lives in.

So I built the bakery's software. [Proof of Concept Bakery](https://bakery.ihaveasegway.com/) is live, and you can use
it.

## What you can do there

Order from the menu, pick a pickup or delivery slot, and pay with one of Stripe's test cards. No money moves. Then watch
your order on the kitchen board, which updates over a live socket.

Behind the counter there's a staff console with seven pages: the kitchen, the menu, catering, customers, money, dispatch
and the system. Catering runs from an inquiry to a quote, a deposit, a delivery and a paid balance. The CRM has
segments, campaigns and an inbox. The dispatch screen plans the day's deliveries with VROOM, the solver the
[Route Lab](/lab/routes/) uses.

Next to all of it is a guide. When you press something that writes, a note opens beside the button. It shows the
request, the object that decided it, the events it produced, why I used that tool and when it would be the wrong one.

## Everyone gets their own bakery

I didn't want a shared one. In a shared bakery, whatever one visitor types is shown to the next.

So every visitor gets a private sandbox, filled with made-up history: 60 customers, 90 days of closed orders, 12 open
orders and 8 catering events. Change a price or cancel every order on the board, and nobody else sees it. Every night
it's wiped.

It also holds no personal data, because it has nowhere to put any. Sign-in keeps a keyed hash of an account number and
drops the name and the email. The bakery can't send mail, so a receipt is a row in the sandbox's inbox.

## What it runs on

Every backend is Rust, compiled to WebAssembly and running on Cloudflare Workers. The state lives in Durable Objects,
each with its own SQLite database. An order is one object. So is a day's schedule, and so is the kitchen board.

I picked Rust for all of it on purpose. The labs are TypeScript, and I wanted both on hand to compare which language
fits which job.

## What it cost

I started on Nov 4, 2026, and it was live on Nov 6. It has kept changing since.

The site's pages are static files, which cost nothing to serve. The bakery runs code on every order, so it needs
Cloudflare's paid plan. On the free one, about 20 visitors a day could get a sandbox before the limits ran out. The paid
plan is $5 a month. With the bakery's own daily caps full, at 300 sandboxes a day, my cost model says $5.29. I set a
ceiling of $100 a month for the account, with alerts at $10, $25 and $50 on the way up.

What it can't show is paying customers. Everything in it is made up, so there's nothing real to lose.

## Try it

[Place an order](https://bakery.ihaveasegway.com/) and watch the notes open. If something breaks, I'd like to hear about
it.
