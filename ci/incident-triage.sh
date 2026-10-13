#!/usr/bin/env bash
# Headless Maintain loop. Called by a monitoring webhook receiver, a cron job, or a runbook
# automation with the alert text on stdin. Detection stays deterministic and outside this
# script; Claude only diagnoses read-only and writes a new intent.md that enters the pipeline.
#
# Usage:  echo "<alert text>" | ci/incident-triage.sh /path/to/client/repo
#
# Tiered response (from the playbook): 1 sigma logs only, 2 sigma runs this read-only triage,
# 3 sigma additionally pages a human. Wire those thresholds in the monitoring system, not here.

set -euo pipefail

REPO="${1:?repo path required}"
PLUGIN_DIR="${WORKHORSE_PLUGIN_DIR:-$REPO/.claude/plugins/workhorse}"
ALERT="$(cat)"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "incident-triage: ANTHROPIC_API_KEY is not set" >&2
  exit 1
fi
if [ ! -f "$REPO/.workhorse/profile.yml" ]; then
  echo "incident-triage: $REPO is not a WorkHorse repo" >&2
  exit 1
fi

cd "$REPO"
git fetch -q origin
git checkout -q -B "wh/incident-$(date -u +%Y%m%d%H%M%S)" "origin/$(git rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')"

claude -p "Incident triage. Trigger follows between the markers. Follow the wh-incident-triager instructions: diagnose read-only, write a reproducing eval, create a change with intent.md, and return the report.
---BEGIN TRIGGER---
$ALERT
---END TRIGGER---" \
  --plugin-dir "$PLUGIN_DIR" \
  --agent wh-incident-triager \
  --max-turns 40 \
  --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep,Write,Bash(git *),Bash(node *)" \
  --output-format json > "/tmp/wh-triage-$$.json"

node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(r.result || JSON.stringify(r, null, 2));
' "/tmp/wh-triage-$$.json"

# Push the branch so the new intent.md is visible for /workhorse:run; never touches main.
if ! git diff --quiet HEAD -- docs/sdlc .workhorse 2>/dev/null || [ -n "$(git status --porcelain docs/sdlc .workhorse)" ]; then
  git add docs/sdlc .workhorse
  git commit -q -m "chore(sdlc): incident triage intent"
  git push -q -u origin HEAD
fi
