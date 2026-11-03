---
title: "Coding is fun. That won't save it."
summary: I doubt anyone in the back seat of a driverless Waymo is checking the mirrors.
published: 2026-11-03
kind: essay
tags:
  - architecture
  - platform
  - testing
firewall_reviewed: 2026-11-03
---

I started out doing a route and grew into a manager. Then I decided to go into software, to solve problems the business
was having that impacted real people. That brought a different type of fulfillment, and I really enjoyed the coding too.

So it feels kind of strange to say, but I think coding by hand, meaning typing out every line yourself, is dead. Plenty
of good engineers disagree, and I could be wrong.

## How my reviews changed

My code reviews used to be about the syntax, basically the code's grammar, and how it was structured.

Then the AI writing the code slowly began to follow all of my rules, which made me stop doing that. Now the only reviews
I do are to make sure we're changing the right things to solve the current problem. And from what I see, the number of
times it gets that wrong is going down even faster than ever.

I don't think I'm the only one checking less. When
[Sonar](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/),
which sells code quality tools, surveyed over 1,100 developers, 96% wouldn't say they fully trust that AI code is
correct. Only 48% said they always check it before adding it to the project.

[Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy) makes the AI coding tool Claude Code, and says
new users let it run on full auto-approve, where it doesn't stop to ask before each step, in about 20% of sessions. After
750 sessions, it's over 40%.

My guess is people check less once it's been right enough times. To me, that's a sign AI can do our jobs a bit more than
we give it credit for.

That doesn't prove it's right, though. Part of it is probably people getting tired of reviewing.
[DORA](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report), a research program
at Google Cloud, ties more AI use to less stable software releases in its 2025 report. So I still think we should trust
but verify the work of the bots.

## Out in the physical world

[Waymo says](https://waymo.com/blog/shorts/safetydata-september26/) it's had 95% fewer serious injury crashes than human
drivers over 270 million miles.
[The Insurance Institute for Highway Safety](https://iihs.org/news/detail/waymos-driverless-cars-crash-less-often-than-people),
which doesn't work for Waymo, found 68% fewer police-reportable crashes per mile. I doubt anyone in the back seat is
checking the mirrors.

Humanoid robots are a lot further behind. [Figure](https://www.figure.ai/news/production-at-bmw), which makes them, says
its robots loaded about 90,000 parts at a BMW plant over 11 months.

Once robots do more and more of this, I think we'll look back at driving all night to make a delivery window, or lifting
boxes until your back gives out, and be like:

> "Yeah, that was kind of a shitty job, and I'm glad nobody has to do that now."

In 1880, the horses in New York and Brooklyn left
[three to four million pounds of manure a day](https://escholarship.org/content/qt6sm968t2/qt6sm968t2.pdf). Somebody had
to shovel that.

I wouldn't put writing code on that list. It's fun. I've really enjoyed getting it wrong a bunch of times and finally
watching it run, and I'll probably get a little sentimental about it someday.

## What I think we do next

People pay for software to solve a problem. They've never much cared how it got typed. So when I say coding by hand is
dead, I mean for a living, however much we like it.

I doubt anybody losing a paycheck feels glad. When dial phones replaced telephone operators, a common job for American
women, a study found [the ones already in the job and over 25](https://www.nber.org/papers/w28061) were less
likely to be working ten years later. It also found overall employment didn't drop for the young women who came after,
because middle-skill clerical jobs and lower-skill service jobs grew. We're the ones already in the job. I don't know if
being flexible would have helped those operators, but it's the best idea I've got.

So I think we need to pick up the new tools and abstractions, no matter what they turn out to be. An abstraction hides
the details, the way an automatic transmission hides the gears. The harder part is working out which parts of our job
are changing forever and what new work shows up as the technology progresses. So far my reviews have moved closer to the
problem, and at the core of it, I really love solving problems.

I'm going to keep trying each new tool and see what it changes.
