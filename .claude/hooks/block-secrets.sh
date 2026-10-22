#!/usr/bin/env bash
# PreToolUse(Bash): block `git commit` when the staged diff holds something that looks like a secret.
in=$(cat)
cmd=$(printf '%s' "$in" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
printf '%s' "$cmd" | grep -E -q 'git( +-C +[^ ]+)? +commit' || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if command -v gitleaks >/dev/null; then
  gitleaks git --staged --exit-code 3 --redact --no-banner -c .gitleaks.toml >/dev/null 2>&1
  if [ $? -eq 3 ]; then
    echo "Blocked: gitleaks found a possible secret in the staged changes. Remove it and unstage the file." >&2
    exit 2
  fi
  # any other result (old gitleaks, config error): fall through to the regex check
fi
# commit -a / --all / paths commit changes that are not staged yet: scan those too
scan="git diff --cached -U0"
printf '%s' "$cmd" | grep -E -q 'commit.* (-[a-zA-Z]*a[a-zA-Z]*|--all)( |$)|commit .* -- ' && scan="git diff HEAD -U0"
pat='(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{32,}|AccountKey=[A-Za-z0-9+/=]{40,}|SharedAccessKey=[A-Za-z0-9+/=]{20,}|(api[_-]?key|secret|token|password|ADO_PAT)[ "'"'"']*[:=][ "'"'"']*[A-Za-z0-9+/_-]{24,})'
if $scan -- . ':!uv.lock' ':!package-lock.json' | grep -E '^\+' | grep -v '^+++' | grep -E -i -q "$pat"; then
  echo "Blocked: the staged changes look like they contain a secret (key, token, connection string). Remove it and unstage." >&2
  exit 2
fi
if git diff --cached --name-only | grep -E -q '(^|/)\.env($|\.)|\.pem$|\.key$' ; then
  if git diff --cached --name-only | grep -E -v '\.env\.example$' | grep -E -q '(^|/)\.env($|\.)|\.pem$|\.key$'; then
    echo "Blocked: a .env, .pem or .key file is staged." >&2
    exit 2
  fi
fi
exit 0
