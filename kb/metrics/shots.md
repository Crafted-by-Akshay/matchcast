---
title: Shots and shots on target
---

## Definition

A shot is an attempt to score with any part of the body that is meant to put the ball in the goal. A shot on target is a shot that would have gone in, or was stopped by the goalkeeper or a defender on the line. Shots that miss the frame or hit the woodwork and stay out are shots off target.

## How MatchCast measures it

`shots:<team_id>` counts every shot event for the team. `shots_on_target:<team_id>` counts the shot events whose `on_target` flag is true. A goal is also recorded as a shot on target, because the ball was on its way in.

## Reading the two numbers together

A team with many shots but few on target is creating attempts from poor positions or under pressure. A team with fewer shots and a high share on target is choosing its moments. Neither number says how good the chances were; that is what expected goals adds.
