#!/usr/bin/env bash
# SessionStart: print where we are and the open backlog for this lane. Never fails the session.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
echo "MatchCast session. Branch: ${branch:-unknown}. Read CLAUDE.md and your lane's CLAUDE.md."
git log --oneline -5 2>/dev/null
lane=${MATCHCAST_LANE:-${branch%%/*}}
case $lane in
  platform) prefix=PLT ;; agents) prefix=AGT ;; experience) prefix=EXP ;;
  data) prefix=DAT ;; quality) prefix=QUA ;; *) prefix= ;;
esac
if [ -n "${ADO_PAT:-}" ] && command -v curl >/dev/null && command -v python3 >/dev/null; then
  filter="[System.State] IN ('New','Active')"
  [ -n "$prefix" ] && filter="$filter AND [System.Title] CONTAINS '$prefix-'"
  q="{\"query\":\"SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MatchCast' AND [System.WorkItemType] = 'User Story' AND $filter ORDER BY [Microsoft.VSTS.Common.Priority], [System.Id]\"}"
  base=https://dev.azure.com/axp219/MatchCast/_apis/wit
  ids=$(curl -s -m 8 -u ":$ADO_PAT" -H 'Content-Type: application/json' -d "$q" "$base/wiql?\$top=8&api-version=7.1" |
    python3 -c 'import sys,json; print(",".join(str(w["id"]) for w in json.load(sys.stdin).get("workItems",[])))' 2>/dev/null)
  if [ -n "$ids" ]; then
    echo "Open stories ${prefix:+for $prefix }(Azure Boards, state New or Active):"
    curl -s -m 8 -u ":$ADO_PAT" "$base/workitems?ids=$ids&fields=System.Title,System.State&api-version=7.1" |
      python3 -c 'import sys,json
for w in json.load(sys.stdin).get("value",[]):
    f=w["fields"]; print("  AB#%s [%s] %s" % (w["id"], f["System.State"], f["System.Title"]))' 2>/dev/null
  else
    echo "Azure Boards: no answer (offline or ADO_PAT unset). Backlog source: azure-boards/BACKLOG.md in the project files."
  fi
else
  echo "Azure Boards: ADO_PAT not set in this environment. Backlog: azure-boards/BACKLOG.md in the project files."
fi
exit 0
