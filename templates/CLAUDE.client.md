# {{client_name}}: working in this repository

Keep this file under one page. It is read at the start of every Claude Code session.

## Commands

- Install: `{{install}}`
- Typecheck: `{{typecheck}}`
- Lint: `{{lint}}`
- Test: `{{test}}`
- Build: `{{build}}`

## Architecture in five lines

1. 
2. 
3. 
4. 
5. 

## Conventions

- Branches: `{{branch_prefix}}<change-id>`; commits: {{commit_style}}
- Tests live next to code as `*.test.*`; never edit tests to make them pass
- 

## Protected

Do not edit without asking: {{protected_paths}}

## Mistakes to avoid

Appended by retro after each change. Newest first.

- 

## Workflow

This repo uses WorkHorse. Start any change with `/workhorse:run "<problem> -> <outcome>"`. Artifacts
live in `docs/sdlc/<change-id>/`. Approvals are recorded with `/workhorse:approve`.
