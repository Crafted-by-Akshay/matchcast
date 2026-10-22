---
title: Goals
---

## Definition

A goal is counted each time a whole ball crosses the goal line between the posts and under the crossbar, and the referee allows it. MatchCast counts a goal for the team that scored it, so an own goal is credited to the opponent of the player who put it in.

## How MatchCast measures it

The metric name is `goals:<team_id>`. It is a count with units `count`, so the Verifier accepts no tolerance: the number in a line must equal the number recounted from the stored goal events. The score shown on screen is the same pair of counts.

## Worked example

If Northgate FC have two goal events and Harbour United have one at full time, the claim values are `goals:home = 2` and `goals:away = 1`, and the score reads 2-1.
