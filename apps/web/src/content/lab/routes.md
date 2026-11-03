---
title: Plan a bakery’s deliveries
summary: A made-up bakery, its vans and the day’s orders. VROOM plans the routes in your browser, on OpenStreetMap roads, and the map shows the driving it saves.
lifecycle: live
runtime:
  kind: browser
decisions: ['0016']
firewall_reviewed: 1970-01-01 # NOT A REVIEW: no person has read this entry. Set the UTC day of the read; the review stamp in verify refuses this value until then.
---

## What VROOM promises

[VROOM](https://github.com/VROOM-Project/vroom) 1.15.0 is an open-source solver for vehicle routing problems. Give it places to visit, vans that hold so many boxes, and the time to drive between every pair of places, and it looks for the routes with the least total driving. The exact best plan takes far too long to find once there are more than a few stops, so VROOM builds a good plan quickly, then moves and swaps stops between routes until no change cuts the total driving. So it promises a good plan fast, and not always the best one.

It runs in your browser, so planning sends nothing anywhere. The drive times come from [OSRM](https://project-osrm.org/)’s car profile over OpenStreetMap roads, and they assume no traffic.

## Three things to try

**Plan every order at once.** Choose that day: dealt to four vans in turn, its 63 orders take 20 h 18 min of driving. VROOM plans them in 6 h 51 min and needs only 3 of the 4 vans.

**Change the vans.** On a busy Saturday, choose 1 van, then 4. One van drives 3 h 2 min and is back after 4 h 2 min. With 4, VROOM uses three of them: 3 h 19 min of driving, and the last van back after 1 h 44 min.

**Tap a place on a map.** That adds or removes its order. Both plans change by themselves, and the headline says what VROOM saves now.

Then choose a quiet Tuesday and go from 2 vans to 3. Each van’s room drops from 10 boxes to 7, and VROOM’s last van is back later: after 1 h 49 min instead of 1 h 33 min.

## How to read it

As the orders came in: the orders are dealt to the vans in turn, like cards, and each van drives its orders in the order they arrived, from the bakery and back. Planned by VROOM: the same orders and the same vans, with the total driving as short as VROOM can make it. Up to 30 orders, each stop on the map carries its number in its van’s run. Every van holds the boxes for 1.3 times its share of the day, so both plans fit, and VROOM still has to balance the loads. So a van’s room changes with the number of vans: the 1.3 does not.

In VROOM’s plans, one van drives the least, but it is back last. More vans usually finish the day sooner, and each map’s “Last van back” line says when, handing over every order included. VROOM looks for the least total driving, not the earliest finish, so with more vans than the day needs it may leave one at the bakery or give one a short run, and the day can even end later.

Each band is an isochrone: the area a van reaches from the bakery within a set time. The band around the bakery is 5 minutes away, and each band after it adds 5 minutes, up to 30. A line marks where 10 and 20 minutes end on land. A band that reaches far along a road marks a fast road. A gap marks water, a park or a port with no street to drive. The list of places, the tables and the tip over each place give its drive time from the bakery as text.

## What it costs

Nothing to run. Every file is static, and your browser does the planning.
