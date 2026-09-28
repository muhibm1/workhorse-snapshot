---
name: wh-compliance-hipaa
description: HIPAA Security and Privacy Rule controls for WorkHorse changes that touch protected health information (PHI) in US healthcare contexts. Loaded when profile.compliance.regimes includes hipaa.
user-invocable: false
---

# HIPAA controls

Applies when the profile lists `hipaa`, or when a change touches protected health information
(PHI): any health, treatment, or payment information linked to an identifiable person, held by
a covered entity or business associate.

## At spec time

- **Minimum necessary.** Each access path exposes the least PHI needed for its purpose. Views
  and API responses are scoped per role.
- **Access control (164.312(a)).** Unique user ids, role-based access, emergency access
  procedure, automatic logoff, and encryption at rest for PHI stores.
- **Audit controls (164.312(b)).** Every read and write of PHI is logged: who, what record,
  when, from where. Append-only. Retained six years.
- **Integrity (164.312(c)).** PHI cannot be altered or destroyed without detection. Pin
  identity and clinical columns with triggers; keep change history.
- **Transmission security (164.312(e)).** TLS everywhere PHI moves. No PHI in URLs, query
  strings, email subjects, or push notification bodies.
- **Business associate agreements.** Any new vendor that touches PHI (hosting, logging, email,
  analytics, LLM provider) needs a BAA. Flag at the point of adding the dependency. No PHI to
  a vendor without one.
- **De-identification.** If data is used for analytics, training, or evals, it is
  de-identified under Safe Harbor (18 identifiers removed) or expert determination, and the
  method is recorded. Eval datasets are synthetic.
- **Breach notification.** Detection and logging must be able to answer what was accessed and
  by whom; notification within 60 days of discovery.

## At review time

- No PHI in logs, error trackers, analytics, or test fixtures.
- Audit log writes are in the same transaction as the PHI access, or the access fails.
- Role tests prove a user in role A cannot read role B's records, with hidden-ness asserted.
- Backups are encrypted and their restore path is documented.
- Session timeout and re-authentication for sensitive actions are implemented, not planned.

## At handover

`docs/handover/security.md` lists PHI data stores, access roles, audit log location and
retention, BAAs in place, encryption details, and the breach response process.

Epistemic note: controls as commonly applied; the client's privacy or compliance officer owns
the legal interpretation. Flag, do not decide.
