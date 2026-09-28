# Plan: {{title}}

Change id: `{{change_id}}`
Spec: [spec.md](./spec.md)
Branch: `{{branch}}`
Worktree: `{{worktree}}`

## Approach

One paragraph. The shape of the implementation and why this order.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | | |
| modify | | |

## Tasks

Each task is small enough for one builder session, has its test written first, and names its
files. Tasks marked `parallel` share no files and may run concurrently in separate worktrees.

### Task 1: {{name}}

- Requirement(s): R1
- Files: 
- Parallel: no
- Steps:
  1. Write failing test: `path` asserting ...
  2. Run test, confirm it fails for the right reason.
  3. Implement minimal change in `path`.
  4. Run test, confirm green. Run full suite.
  5. Commit: `feat(scope): message`
- Done when: 

## Verification plan

Which profile commands run, which evals, what the human will see as evidence.

## Rollback

How to undo this change in each environment. Rehearsed at G5 for tier 2 and above.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| | | | |
