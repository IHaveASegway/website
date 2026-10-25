---
title: Plan a bakery’s deliveries
summary: A bakery, its vans and the day’s orders. VROOM plans the routes in your browser, on OpenStreetMap roads, and the map shows the driving it saves.
lifecycle: live
runtime:
  kind: browser
decisions: ['0016']
firewall_reviewed: 1970-01-01 # NOT A REVIEW: no person has read this entry. Set the UTC day of the read; the review stamp in verify refuses this value until then.
---

## How it works

The solver is [VROOM](https://vroom-project.org/) 1.15.0, compiled from its C++ source to WebAssembly. It runs in a Web Worker in your browser, so planning sends nothing anywhere. The drive times come from [OSRM](https://project-osrm.org/)’s car profile over OpenStreetMap roads, worked out once for every pair of the 64 places: 4,032 legs. They assume no traffic.

## What VROOM is

VROOM is an open-source solver for vehicle routing problems. Give it places to visit, vans that hold so many boxes, and the time to drive between every pair of places, and it looks for the routes with the least total driving. The exact best plan takes far too long to find once there are more than a few stops, so VROOM builds a good plan quickly, then moves and swaps stops between routes until no change makes the day shorter.

## What the colour bands are

Each band is an isochrone: the area a van reaches from the bakery within a set time. The band around the bakery is 5 minutes away, and each band after it adds 5 minutes, up to 30. A line marks where 10 and 20 minutes end on land. A band that reaches far along a road marks a fast road. A gap marks water, a park or a port with no street to drive. The list of places, the tables and the tip over each place give its drive time from the bakery as text.

## The two plans

As the orders came in: the orders are dealt to the vans in turn, like cards, and each van drives its orders in the order they arrived, from the bakery and back. Planned by VROOM: the same orders and the same vans, with the total driving as short as VROOM can make it. Up to 30 orders, each stop on the map carries its number in its van’s run. Every van holds the boxes for 1.3 times its share of the day, so both plans fit, and VROOM still has to balance the loads. So a van’s room changes with the number of vans: the share does not.

In VROOM’s plans, one van drives the least, but it is back last. More vans finish the day sooner, which is what the line under each map shows: when the last van is back, handing over every order included. VROOM looks for the least total driving, not the earliest finish, so with more vans than the day needs it may leave one at the bakery, or give one a short run.

## What it costs

Nothing to run. Every file is static, and your browser does the planning.
