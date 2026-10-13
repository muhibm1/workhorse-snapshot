---
name: wh-compliance-pci-dss
description: PCI DSS v4 controls for WorkHorse changes that touch card payments. Loaded when profile.compliance.regimes includes pci-dss. Use in spec, constraint audit, and security review of any payment path.
user-invocable: false
---

# PCI DSS controls

Applies when the profile lists `pci-dss`, or when a change touches cardholder data or the path
a card number travels.

## Scope first

The single most valuable decision is keeping card data out of the client's systems entirely.

- Use a PCI-compliant processor's hosted fields, redirect, or tokenisation so the primary
  account number (PAN) never reaches the client's servers, logs, or database. This keeps the
  client at SAQ A or A-EP rather than SAQ D.
- The spec names the processor, the integration method, and states explicitly whether any
  cardholder data touches client infrastructure. If it does, the constraint auditor raises a
  high finding and the human decides.

## If cardholder data is in scope

- **Req 3.** Never store the CVV/CVC, full track data, or PIN. Mask PAN on display (first six,
  last four at most). Encrypt stored PAN with managed keys, key rotation documented.
- **Req 4.** TLS 1.2 or higher on every hop carrying PAN.
- **Req 6.** Secure development: dependency scanning, input validation, no PAN in URLs, code
  review of every payment-path change (the Ship gate is mandatory and the security reviewer runs).
- **Req 7 and 8.** Least privilege to payment systems, unique ids, MFA for administrative
  access.
- **Req 10.** Log every access to cardholder data and every administrative action, retained
  one year with three months immediately available.
- **Req 11.** Vulnerability scanning and penetration testing on the payment path.
- **Req 12.** Documented policies; the handover pack's security.md carries the client's
  PCI scope statement.

## At review time

- Grep for PAN-shaped values (13 to 19 digits, Luhn-valid) in logs, fixtures, and test data.
  Test cards from the processor's documented list are the only card numbers allowed anywhere.
- Webhook handlers verify signatures before trusting payloads.
- Amounts are integers in minor units; currency is explicit; idempotency keys protect every
  charge.
- Refund and dispute paths have the same authorisation checks as charges.

## At handover

`docs/handover/security.md` carries the scope statement (which SAQ), the processor, the
tokenisation approach, and where payment logs live.

Epistemic note: the client's QSA or acquiring bank owns the compliance determination. Flag, do
not decide.
