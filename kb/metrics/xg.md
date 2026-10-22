---
title: Expected goals (xG)
---

## Definition

Expected goals, written xG, is the probability that a shot becomes a goal, given where and how it was taken. A shot with xG 0.30 is expected to score three times in ten. Adding up the xG of a team's shots gives how many goals an average finisher would have scored from those chances.

## What goes into the number

MatchCast uses a logistic model on the shot's distance to goal and the angle the goal opens up from the shot position. Closer and more central shots score higher. The model's constants are fitted on aggregate rates from open-play shots and are fixed per `derivation_version`, so the same shot always gives the same xG.

## Why it is useful

Goals are rare, so a single match score is noisy. xG shows whether a team deserved its result: a team that wins 1-0 with an xG of 0.4 against 2.1 was probably lucky. xG is a probability, not a promise, and it ignores the goalkeeper and the finisher.

## Worked example

A shot from 11 metres, almost straight on, might carry an xG of about 0.2. A shot from 25 metres out wide might carry 0.02. Ten of the first kind would be expected to produce two goals.
