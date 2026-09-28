---
name: wh-compliance-financial
description: Controls for WorkHorse changes in regulated financial services contexts (banking, lending, payments, trading, insurance) under regimes such as FCA/PRA, SEC/FINRA, DORA, SOX, and AML/KYC obligations. Loaded when profile.compliance.regimes includes financial.
user-invocable: false
---

# Financial services controls

Applies when the profile lists `financial`. The exact regime depends on jurisdiction and
licence; this skill covers the engineering controls that recur across them. Tier 3 applies to
any change that moves money, changes balances, alters eligibility or pricing decisions, or
touches records a regulator can demand.

## Money and ledgers

- Amounts are integers in minor units with explicit currency. Never floating point.
- Every balance change is a double-entry ledger event: immutable, append-only, with a
  reference to the business event that caused it. Balances are derived, never edited.
- Idempotency keys on every money-moving operation; retries never double-charge.
- Reconciliation: a scheduled job compares internal ledger to processor or bank statements and
  alerts on any difference. The spec names it.

## Records and audit (SOX, FCA SYSC, SEC 17a-4 style obligations)

- Records that support a financial statement or a customer outcome are retained for the regime's
  period (commonly five to seven years), immutable, and exportable.
- Every decision affecting a customer (approval, decline, pricing, limit) stores its inputs, the
  rule or model version, and the output, so it can be explained later.
- Admin overrides are logged with actor, reason, and approver.

## Models and automated decisions

- Any model or rule that affects credit, pricing, fraud, or eligibility has: a version, a
  documented validation, monitoring for drift, and a human review path for adverse outcomes.
  Explainability requirements apply (adverse action reasons, GDPR Art. 22 where relevant).
- Fairness testing across protected characteristics is part of the evals for such models.

## Operational resilience (DORA, FCA PS21/3)

- Important business services have documented impact tolerances; the change does not lower
  them. Failure modes in the spec name the customer impact.
- Third-party dependencies added to a critical path are recorded with exit and substitution
  plans in `open-items.md`.
- Incident classification and regulator notification timelines are in the runbook.

## AML/KYC and sanctions where relevant

- Onboarding and transaction flows call the client's screening provider before funds move;
  the code cannot skip the call on error. Fail closed.
- Screening results and their timestamps are retained.

## Access and segregation of duties

- The engineer who writes a money-moving change cannot be the sole approver of its deployment.
  The Ship (G4) and Deploy (G5) approvers should differ where the client's policy requires it;
  record both.
- Production access is time-boxed and logged.

## At review time

- Grep for floating-point money, missing idempotency, editable ledger rows, and decisions
  stored without their inputs.
- Confirm the rollback plan cannot leave the ledger inconsistent.

Epistemic note: the client's compliance function and regulator define the obligations in
force. Flag, do not decide.
