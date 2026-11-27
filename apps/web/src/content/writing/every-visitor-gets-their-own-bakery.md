---
title: Every visitor gets their own bakery, and it's gone by morning
summary: How a made-up bakery gives each visitor a private copy, holds no personal data, and wipes everything at 10:00 UTC.
published: 2026-11-27
kind: pattern
draft: true
tags:
  - durable-objects
  - security
  - architecture
firewall_reviewed: 2026-11-27
---

[Proof of Concept Bakery](https://bakery.ihaveasegway.com/) is a made-up bakery with working software that anyone can
change. One visitor opens the console and changes the price of the cardamom bun. Another, in the same minute, cancels
every order on the board. A third types a phone number into an order note.

None of them should see the others' work, and I shouldn't be left holding something that names a person.

## The designs I didn't use

The usual first design is one shared bakery: one database, every visitor in it. Anything one person types is shown to
the next, so it needs moderation, and anything personal that lands in it stays until someone finds it.

The second design keeps the shared tables and adds a tenant column to every row, with a filter on every query. One
query without its filter shows every visitor everything.

## A name that carries its sandbox

The bakery has no shared table to filter. A sandbox is a set of Durable Objects, each with its own SQLite database. The
server builds every object's name from the sandbox id in the signed session, so a visitor's browser never names an
object. A name with another sandbox's id is a different object, and a path that names one gets a 404.

Each sandbox keeps a list of the objects it created. An object is written into that list before it is first used, in
the same request. An object that isn't on a list refuses every command, so a guessed name summons nothing. It's also why
the wipe has one list to work from and can't miss anything.

## Made up, and the same every time

A new sandbox starts with history: 60 customers, 6 venues, 64 delivery places, 90 days of closed orders, 12 open orders
and 8 catering events. All of it comes from one random seed and a date, so two sandboxes from the same seed and date are
identical byte for byte. A bug report can name its seed.

A customer is a made-up pair of words, like Fennel Talus. A delivery address isn't an address at all. It's one of 64
numbered places on the map.

## Nowhere to put personal data

I didn't want to promise to be careful with personal data. I wanted there to be no column for it.

Sign-in stores a keyed hash of the provider's number for the account. Google is asked for one scope, the one that
says who signed in and nothing else, and if a provider ever sends an email, a name or a picture, the callback drops them before anything is stored or logged.

The bakery has no address to send mail from or to. A receipt is a row in the sandbox's inbox, and its recipient is a
customer id.

There are two free-text fields, an order note of 140 characters and a catering brief of 500. Both are refused when they
hold something shaped like an email, a phone number, a card number or a link.

## What that costs

A name or a street typed as plain words still gets through those checks. It lives in that one sandbox until 10:00 UTC,
when everything is wiped.

And nothing in the bakery is real. The customers who open a campaign are made up too. It can show how the software
works, and it can't show how real people use it.

The longer version, with the code, is on the bakery's own page:
[how the sandbox is built](https://bakery.ihaveasegway.com/how-its-built/sandbox/).
