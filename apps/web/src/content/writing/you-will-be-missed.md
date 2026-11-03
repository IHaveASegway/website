---
title: You will be missed
summary: I doubt anyone in the back seat of a driverless Waymo is checking the mirrors.
published: 2026-11-02
kind: essay
tags:
  - architecture
  - platform
  - testing
firewall_reviewed: 2026-11-03
---

I didn't start in software. I started out driving a route.

It was honest work and I learned a lot from it, but I don't really miss it.

Then I got into software, a little at a time, and I really enjoyed it. I liked sitting with a problem, getting it
wrong a bunch of times, and finally watching it run.

So it feels kind of strange to say this, but I think the part of my job where I write code by hand is going away.

## I stopped reading the code

I didn't type this site's code. AI coding agents wrote it. I look at the site on my phone and tell them what's wrong.

The other day I looked up how much I've been reviewing all of this. More than 50 pull requests have gone into this
site, each one a batch of code changes, and GitHub shows I left zero comments on any line.

I don't remember deciding to stop reading the code. It just kind of happened.

I don't think it's only me, either. When
[Sonar](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/),
which sells code quality tools, surveyed over 1,100 developers, 96% said they don't fully trust that AI code is
correct. Only 48% said they always check it before they commit it to the project.

[Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy), which makes a coding agent called Claude
Code, found new users let it run on full auto-approve, where it doesn't stop to ask before each step, in about 20% of
sessions. By the time someone's used it for 750 sessions, it's over 40%. Experienced users also interrupt it more, so
it looks to me like they haven't tuned out. They just stop reading every step and jump in when something looks off.

And the amount of code keeps climbing. [Greptile](https://www.greptile.com/reports/state-of-ai-coding), which sells AI
code review, says lines changed per developer on its customers' teams went from about 6,000 a month to about 21,000 a
month in a year. [aictrl](https://aictrl.dev/blog/open-source-review-ai-era), which also sells AI code review, looked
at 26 open source projects. In the typical one that was big before AI coding tools, pull requests merged with no
comment from a person went from 42% to 54% between early 2025 and the third quarter of 2026. I've seen something like
this in my own work too: a lot more code going live, and a lot fewer changes requested by the people reviewing it.

I don't want to read too much into that. Part of it is probably just people getting tired of reviewing.
[DORA](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report), a research program
at Google Cloud, ties more AI use to less stable software releases in its 2025 report. And every test on this site was
green, but on my phone the site was still unusable.

So I still think we should trust but verify.

But I don't think people stop checking something they expect to be wrong most of the time. My guess is they stop when
it's been right enough times. To me, that's a sign AI can do our jobs a bit more than we give it credit for.

## It's not just code

I doubt anyone in the back seat of a driverless Waymo is checking the mirrors.

[Waymo says](https://waymo.com/blog/shorts/safetydata-september26/) it's had 95% fewer serious injury crashes than human
drivers over 270 million miles, and that's its own number.
[The Insurance Institute for Highway Safety](https://iihs.org/news/detail/waymos-driverless-cars-crash-less-often-than-people),
which doesn't work for Waymo, ran its own study and found 68% fewer police-reportable crashes per mile.

Humanoid robots are a lot further behind. [Figure](https://www.figure.ai/news/production-at-bmw), which makes them,
says its robots loaded about 90,000 parts at a BMW plant over 11 months, and that's one narrow job. But I'd guess
that's how this starts.

When I picture where it goes, I think one day we'll look back at a lot of this work and be like:

> "Yeah, that was kind of a shitty job, and I'm glad nobody has to do that now."

Driving all night to make a delivery window. Lifting boxes until your back gives out.

In 1880, the horses in New York and Brooklyn left
[three to four million pounds of manure a day](https://escholarship.org/content/qt6sm968t2/qt6sm968t2.pdf) on the
streets and in the stables. Somebody had to shovel that. I've never heard anyone say they wish they'd had that job.

## You will be missed

I don't think that's how I'm going to feel about writing code.

I also don't want to pretend the change is easy. I doubt anybody losing a paycheck feels lucky. When dial phones
replaced telephone operators, [the ones already in the job and over 25](https://www.nber.org/papers/w28061) were less
likely to be working ten years later. I still have to provide, and I honestly don't know what that looks like in ten
years.

But someday somebody's going to ask me what programming was like. I'll probably tell them about getting paged at
3 a.m. when something broke, and the bug that took all week. Then I'll tell them about the time it finally worked, and
I'll get a little sentimental about it.

So, to writing code by hand: you were good to me.

You will be missed.
