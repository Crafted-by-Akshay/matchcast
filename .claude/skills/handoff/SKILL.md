---
name: handoff
description: Use when finishing a story or ending a session to write the handoff note and evidence so the next session or lane can continue without asking.
---

# Handoff

Definition of done item 7 (`docs/architecture/16-testing-and-quality.md` §3): a short note per story.

## Where
- The lane's task file (doc 16 §3 item 7) gets the note; also post it as a PR comment (the permanent record) and, for stories with proof to keep, `docs/evidence/<STORY>.md`. Update the lane's README or the matching `docs/architecture/` file if behaviour changed.
- Save lasting facts the next session would otherwise ask Akshay again (decisions, IDs, quotas, gaps) to project memory, one file per subject.

## Note format (under 25 lines)
```
Story: AB#<id> <title>        PR: #<n>        Commit: <short sha>
Done: <what works, visible where>
Evidence: <command> -> <result>   (tests, screenshots, local_ci summary)
Not done / limits: <explicit, including anything Simulated or Planned>
Decisions: <ADR numbers, deviations from the story text and why>
Next: <the next step and who owns it>
Touches other lanes: <folders, contracts, env vars, new routes>
```

## Rules
- Report outcomes as they are: failing check, skipped job and unverified claim all go in the note.
- Azure Boards: set Completed Work first, then State Closed (Closed needs no Remaining). Close tasks that are merged; leave the story Active until all its tasks are done.
- Never put a key, token or password in the note.
