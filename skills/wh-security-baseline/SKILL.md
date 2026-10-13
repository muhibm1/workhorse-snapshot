---
name: wh-security-baseline
description: Security engineering rules and the pre-ship checklist applied to every WorkHorse change that touches auth, a database, RLS, functions, storage, secrets, CI, or an admin surface. Loaded by the designer, constraint auditor, security reviewer, builder, and shipper.
user-invocable: false
---

# Security baseline

Distilled from a full OWASP, SOC 2, ISO 27001 and GDPR audit of a production codebase. Every
rule exists because its absence produced a real finding.

## Row-level security is not column-level security

An RLS `for update` policy gates rows, not columns. The row owner can rewrite every column,
including the ones that decide identity, authorization, ordering, or billing. This produced four
findings in one codebase, one Critical: a `requester_id` rewritable by the recipient forced open
a private channel with an arbitrary victim because a visibility policy elsewhere trusted it.

- For every `for update` policy, list every column on the table and ask "may this caller change
  this?" The policy predicate is not the answer.
- Pin columns with a `BEFORE UPDATE` trigger that raises a human-readable message. Pin anything
  that says who a row is about, what it originally asserted, or who decided it. Leave state
  machine columns to the policy.
- Any column another security decision reads must be pinned. Trace reads before calling a
  column boring.
- Anything the client is trusted to stamp honestly is not enforced. If the app sets
  `edited_at`, the database sets it too.

## Revoke default privileges, then grant explicitly

Supabase and default Postgres grant `EXECUTE` on every new function in `public` to `anon`,
`authenticated`, and `PUBLIC`. A `SECURITY DEFINER` function that takes a caller-supplied id and
is not anchored to `auth.uid()` is an unauthenticated read oracle.

- Early in any Postgres project:
  `alter default privileges in schema public revoke execute on functions from public, anon, authenticated;`
- Every `SECURITY DEFINER` function gets an explicit grant line and a one-line comment saying who
  may call it and why, in the same migration that creates it.
- Classify each function: trigger function, must stay reachable by `anon` (used inside an RLS
  policy a signed-out visitor reaches; grep policy bodies before revoking), authenticated only,
  or internal helper (revoke from all).
- Prefer functions with no caller-supplied identity argument, scoped to `auth.uid()` internally.
- Always `set search_path = public` on `SECURITY DEFINER` functions.

## CREATE OR REPLACE is a diff, not a new file

Replacing a function requires the full body, and anything not carried forward is silently
deleted. This is how an ownership-transfer function lost its audit-log write and its
notification for weeks with no failure.

- Retrieve the previous definition and diff it line by line against the new one.
- State in the migration comment what was deliberately removed.
- Watch for side effects with no return value: audit-log writes, notifications, counters,
  cache invalidations.
- The same applies to `drop policy` + `create policy`: state that every clause is preserved.

## Verify empirically before asserting

- Never write a factual claim into a migration comment, commit message, or report unless you
  checked it. Query the catalog, read the vendor source, run the command.
- Label epistemic status inline: "confirmed against pg_proc.proacl" or "believed, not verified".
- When a fix is scoped narrower than the problem, say so, say why, and describe what remains.

## CI must actually run the security tests

- A suite that skips cleanly without credentials reports a green build having run zero security
  tests. CI must assert the secrets exist and fail naming the missing variables.
- Assert a non-zero test count for the security project.
- Test credentials point at a dedicated test project, never production, and never fall back to
  app credentials.
- Minimum CI for any project with a data model: typecheck, lint, full tests, dependency audit.

## Defaults from the first week

- Security headers from the first deploy: CSP (`script-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`, `connect-src` scoped), HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`.
- CORS pinned to the deployed origin.
- Error tracking from day one with PII scrubbed in `beforeSend`.
- No failure path that is both silent and consequential.
- `.well-known/security.txt`, Dependabot or Renovate plus `npm audit` in CI, branch protection
  requiring CI, and a committed `docs/hosted-config.md` for anything that lives only in a vendor
  dashboard.

## Privacy defaults

- Default to the most private setting and record the reasoning when changing a default.
- Enforce promises in the schema, not the UI. "No cold DMs" is real when the table has no
  INSERT policy.
- Test account deletion end to end against a realistic user. Tombstone where deletion would
  destroy another person's data, and write down the retention position.
- Provide data export scoped by running as the caller.
- Special-category data arrives by inference, not by field name. If it is inferable, it is
  special-category.
- The first analytics SDK, third-party script, or email provider creates a cookie-consent
  obligation and a subprocessor. Flag it at the point of adding the dependency.

## Pre-ship security checklist

Worked through by the security reviewer at tier 2 and above; its report records every line
ticked or waived with a reason, and the Ship document carries the result.

- [ ] Every new or changed `for update` policy: all columns listed, each decided, pinning
      trigger added where the policy is not sufficient.
- [ ] Every new or changed `for insert` policy: the UPDATE path re-checks the same invariants.
- [ ] Every new function: explicit grant or revoke in the same migration; `SECURITY DEFINER`
      justified; `search_path` set; anchored to `auth.uid()` or the reason stated.
- [ ] Every `CREATE OR REPLACE`: diffed line by line; side effects confirmed present.
- [ ] Every new policy ships two tests in the same commit: one admitting the right rows, one
      denying the wrong ones.
- [ ] Deny-side assertions distinguish failure modes: hidden-ness for reads, rejection for
      writes, and read-back with an admin client for blocked updates.
- [ ] New storage bucket: private unless there is a written reason.
- [ ] New table holding user free text: length constraint, and a rate limit if insertable in a
      loop.
- [ ] New admin capability writes to an append-only log.
- [ ] New secret or env var covered by `.gitignore` as a pattern; confirmed with `git ls-files`.
- [ ] New third-party import in a runtime path pinned to an exact version.
