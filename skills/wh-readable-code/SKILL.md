---
name: wh-readable-code
description: The readability and adoption standard for code WorkHorse produces in client repositories. Loaded by the designer, builder, polish, and adoption reviewer. Use when writing or reviewing any source file.
user-invocable: false
---

# Readable code standard

The code outlives the engagement. A client engineer with no context must be able to read it,
change it, and trust it. Optimise for the reader, not the writer.

## Structure

- One responsibility per module. If a file needs a table of contents, split it.
- Public interface at the top, helpers below. A reader should understand what a module does
  from its exports and their names before reading a body.
- Functions under 40 lines. Nesting under three levels. Early returns over else-chains.
- No clever code. If a construct needs a comment to explain how it works, restructure it. Comments
  say why, never what.
- Follow the client's existing patterns even when you would do it differently. Consistency is
  worth more than your preference. Record disagreements in an ADR, not in the code.

## Naming

- Names say what a thing is or does in the domain's language: `invoiceDueDate`, not `d` or
  `data2`. Booleans read as predicates: `isOverdue`, `hasConsent`.
- No abbreviations unless the client already uses them. No suffixes like `Manager`, `Helper`,
  `Util` that hide what the thing does.
- One name per concept across the codebase. If the spec calls it a "tenant", the code does not
  call it an "org".

## Errors and edges

- Every error is either handled with a specific action or surfaced with context. Never swallowed.
- Validate at boundaries (HTTP, queue, file, database) and trust the interior.
- Handle empty, null, maximum, unicode, and concurrent cases in the code, and test them.

## Tests as documentation

- Test names are sentences: `returns 404 when the invoice belongs to another tenant`.
- One behaviour per test. Arrange, act, assert, with blank lines between.
- Tests live where the client keeps them, named the way the client names them.

## Dependencies

- Prefer the standard library, then what the repo already uses, then a well-maintained library
  pinned to an exact version. Justify any addition in the plan.

## Documentation the code carries

- A module doc comment of one to three lines when the purpose is not obvious from the name.
- Public functions with non-obvious contracts get a short doc comment: inputs, outputs, errors.
- README sections updated in the same change when behaviour visible to a user or an operator
  changes.

## Review questions the polish pass asks

1. Can I state what each changed file does in one sentence without reading its body?
2. Are there names I had to look up to understand?
3. Is there any construct a mid-level engineer on this client's stack would not recognise?
4. Could I delete a comment without losing information? Then delete it.
5. Does this change follow the pattern the repo already uses for the same kind of thing?
