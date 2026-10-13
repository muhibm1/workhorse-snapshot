# Release: {{title}}

Change id: `{{change_id}}`
Version: {{version}}
PR: {{pr_url}}
Merged commit: `{{commit}}`

## Changelog

User-facing, one line per change, grouped Added / Changed / Fixed / Security.

## Deploy plan

| Environment | Command | Auto | Gate | Status |
|-------------|---------|------|------|--------|
| dev | | yes | none | |
| staging | | yes | none | |
| prod | | no | G5 | |

Pre-deploy checks:
- [ ] Verification green at merged commit
- [ ] Migrations reviewed for reversibility
- [ ] Feature flags or config changes listed below

Config and secrets touched (names only, never values):
- 

## Rollback

Exact commands, per environment. Rehearsed on {{rehearsal_date}} in {{rehearsal_env}}: {{rehearsal_result}}.

## Runbook

What to watch after deploy, for how long, and what to do if it goes wrong.

| Signal | Where | Threshold | Action |
|--------|-------|-----------|--------|
| | | | |

## Deploy record

| Environment | At (UTC) | By | Commit | Result |
|-------------|----------|----|--------|--------|
| | | | | |
