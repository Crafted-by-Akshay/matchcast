---
title: Fouls and cards
---

## Definition

A foul is a careless, reckless or excessive challenge against an opponent, or another offence the referee punishes with a free kick or penalty. The referee can show a yellow card as a caution or a red card to send a player off.

## How MatchCast measures it

`fouls:<team_id>` counts foul events committed by the team. `cards:<team_id>` counts every card shown to the team's players, yellow and red together. `red_cards:<team_id>` counts only the red cards, including a second yellow that turns into a red.

## Reading it

A team with a red card plays the rest of the match with one fewer player, which usually changes how the other team attacks. Cards also raise the risk of suspension in competitions, but MatchCast simulates single matches and does not carry suspensions between them.
