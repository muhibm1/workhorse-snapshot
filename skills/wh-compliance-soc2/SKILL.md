---
name: wh-compliance-soc2
description: SOC 2 Trust Services Criteria evidence expectations for WorkHorse changes at clients undergoing or holding a SOC 2 report. Loaded when profile.compliance.regimes includes soc2 or iso27001. Use to make every change leave auditor-ready evidence.
user-invocable: false
---

# SOC 2 evidence

Applies when the profile lists `soc2` or `iso27001`. SOC 2 is about proving controls operate
over time. WorkHorse's artifact chain is itself evidence; this skill makes sure nothing breaks
the chain.

## Change management (CC8)

- Every change has a committed `brief.md`, `spec.md`, `plan.md`, `verification.md`,
  `ship.md`, and `approvals.md`. An auditor can sample any merged PR and trace who
  asked, what was built, what was tested, who approved, and when.
- Branch protection requires CI and a human approval. Agent-written code never merges without
  the Ship approval (G4). The `approvals.md` block records the approver's identity from git config.
- Emergency changes still get a `brief.md`, written after the fact if needed, and a retro.

## Logical access (CC6)

- New roles, permissions, service accounts, or API keys are listed in the spec with owner and
  review cadence. Keys are named, never valued, in artifacts.
- Access removal is tested: a deactivated user cannot read or write. Tests assert denial.
- Admin actions write to an append-only audit log.

## System operations (CC7)

- Every change that adds a failure class adds detection: a log line, metric, or alert named in
  the spec's observability section and in `release.md`'s runbook.
- Incidents produce a retro and an eval. The retro is committed.
- Vulnerability management: dependency audit in CI; findings above medium have a ticket or a
  documented acceptance with owner and date.

## Risk and monitoring (CC3, CC4)

- The risk table in each brief ("What could go wrong") is the change-level risk assessment. Accepted risks
  name an owner.
- `/workhorse:status --metrics` output can be exported periodically as evidence that the process
  operates.

## Availability, confidentiality, privacy (A1, C1, P1) where in scope

- Backups and restore tests documented in `docs/handover/operations.md`.
- Data classification in the profile's `compliance.special_categories` and the security.md.
- Retention and deletion documented and tested.

## At review time

The security reviewer confirms the artifact chain is complete for the change and that nothing
in the change disables logging, CI checks, or branch protection.

Epistemic note: the client's auditor defines the control set in force. This skill produces
evidence in the shape auditors commonly request; it does not certify anything.
