---
name: wh-compliance-gdpr
description: GDPR and UK GDPR controls for WorkHorse changes that process personal data of EU or UK residents. Loaded when profile.compliance.regimes includes gdpr. Use in spec, constraint audit, security review, and handover.
user-invocable: false
---

# GDPR controls

Applies when the profile lists `gdpr`, or whenever a change processes personal data of people
in the EU or UK regardless of where the client is. Personal data is anything relating to an
identifiable person, including identifiers, device ids, and inferences.

## At spec time

- **Lawful basis (Art. 6).** Name the basis for each processing purpose: consent, contract,
  legal obligation, vital interests, public task, legitimate interests. Legitimate interests
  needs a recorded balancing test in the spec.
- **Special categories (Art. 9).** Health, biometrics, genetics, sexual orientation, religion,
  politics, union membership, ethnicity. Inferable counts. Requires explicit consent or another
  Art. 9 condition, and appears in the profile's `special_categories`.
- **Purpose limitation and minimisation (Art. 5).** Each field collected maps to a purpose. A
  field with no purpose is removed.
- **Retention.** Every table holding personal data has a retention period and a deletion
  mechanism named in the spec.
- **Data subject rights (Art. 15 to 22).** Access and export, rectification, erasure,
  restriction, portability, objection. The spec says how each is served for the data this
  change adds. Erasure must be tested against a realistic user.
- **Privacy by design and default (Art. 25).** Most private default. Record the reasoning
  when a default is changed.
- **International transfers (Ch. V).** Any new processor or region outside the EU/UK needs a
  transfer mechanism named (adequacy, SCCs) and appears in `data_residency`.
- **DPIA (Art. 35).** Required for systematic monitoring, large-scale special-category
  processing, or new technology with high risk. The constraint auditor flags when a DPIA is
  needed; the human decides.
- **Subprocessors (Art. 28).** A new SaaS, SDK, analytics, or email provider is a new
  subprocessor. Flag it at the point of adding the dependency.

## At review time

- Personal data does not appear in logs, error trackers, URLs, or analytics events.
- Consent is stored as an event with timestamp, version of the text consented to, and
  mechanism. Withdrawal is as easy as giving it.
- Cookie and tracking consent gates non-essential scripts before they load.
- Access controls prevent cross-tenant reads; tests prove denial, not just non-error.
- Breach detection exists: something logs enough to answer "what was accessed, by whom, when"
  within the 72-hour notification window (Art. 33).

## At handover

`docs/handover/security.md` lists: data categories, purposes and bases, retention table,
subprocessors, transfer mechanisms, how each data subject right is served, DPIA status, and the
breach process with the 72-hour clock.

Epistemic note: these are the controls as commonly applied; the client's DPO or counsel owns the
legal interpretation. Flag, do not decide.
