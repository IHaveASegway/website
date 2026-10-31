---
title: Backfill a week of reports
summary: A nightly job counts the bakery's orders, one run per day. Fail a load, rerun a day, backfill the week, and check every total against the source.
lifecycle: live
runtime:
  kind: browser
decisions: ['0026']
firewall_reviewed: 1970-01-01 # NOT A REVIEW: no person has read this entry. Set the UTC day of the read; the review stamp in verify refuses this value until then.
---

## What a backfill promises

The bakery's report counts each day's orders. A job runs once per day of data: it waits for that day's export file, extracts it, converts it, loads it into the report and checks the report's count against the source. A run belongs to its day, not to the day it happens to run on. That is what makes a backfill possible: switch the job on at the end of the week, and it runs all seven days, three at a time.

It also means every day can run more than once. A load fails half way and retries, someone clears a day to rerun it after a fix, a backfill overlaps a day that already ran. A run that adds its rows each time counts that day twice. A run that replaces its day's rows in one step can run any number of times and leave the same report. That second kind is idempotent, and it is the only kind a backfill is safe with.

## Three things to try

**Watch Wednesday count twice.** The first run does it: Wednesday's first load fails after writing 96 of its 179 rows, the retry appends all 179, and Wednesday's check finds 275 orders against the source's 179. Switch the load to overwrite the day and start over. Every day matches: 2,012 orders.

**Write to today.** Make each load write to the day the clock says instead of its run's own day, and start over. Every day's orders land on the same date, and every check fails. A job that asks the clock for its date cannot be backfilled.

**Rerun a finished day.** Clear Tuesday after its run succeeds. With append, Tuesday's total doubles. With overwrite, nothing changes.

Then make Monday's file five hours late with one run at a time, and watch the week wait behind it.

## What the lines and lamps mean

Each row is a day and each lamp a step of its run, from waiting for the file to the check. A lit lamp is running, a filled lamp has succeeded, a hollow lamp has not started, and a cross has failed; a step waiting to retry carries its next try's time. The column on the right is the day's total in the report against the source. The three properties under the board are checked after every event.

## Credits

Runs that belong to their day of data, and loads that replace a day's rows instead of adding to them, are the core of Maxime Beauchemin's essay "Functional Data Engineering: a modern paradigm for batch data processing" (2018).

## What it costs

Nothing to run. Every file is static, and your browser runs the simulation.
