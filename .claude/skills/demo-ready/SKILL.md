---
name: demo-ready
description: Use before filming the 2-minute demo or the final submission to check that every scene works, labels are honest and the submission rules are met.
---

# Demo ready

Script: `docs/video-script.md` (9 scenes, 120 s, public video under 2 minutes, English narration). Film from the deployed unified app with a fixed seed: `?seed=2026&speed=4` (add `&seedBadClaim=1` for scene 3). Deadline: Oct 27 11:59 pm PT; film Oct 26.

## Checklist
1. `scripts/local_ci.sh` passes on main, and `make e2e` is green.
2. Walk each scene in the script. For each, note the story it depends on, whether it works, and the fallback (voice falls back to captions; scene 8 shortens to 5 s if the evaluation has not run).
3. Honesty: everything not connected says Simulated or Planned; Tamil is out; only English, Spanish and Hindi are offered. The video must not claim a service the app does not call.
4. Hero tech visible and real: Foundry agents, Agent Framework, Azure MCP with Copilot Agent Mode (a recording), Event Hubs, Container Apps, Speech, Databricks and Fabric (screenshots and clips; Fabric is paused after filming).
5. Synthetic data only; credits and licences in the README (three.js, MakeHuman CC0, Wyscout CC BY 4.0, martj42 CC0); repo public before submission is Akshay's call; no secret in the history (`scripts/local_ci.sh secrets`).
6. Judge access: Producer account password goes only in the private notes field of the submission form, never in the repo.
7. Architecture diagrams exported (SUB-6) and the README links them.
8. Cost: `scripts/cost_today.sh`, alerts set, shutdown runbook ready for Nov 10.

Report which scenes pass, which are at risk and what is missing. Do not mark a scene done from the code alone; run it.
