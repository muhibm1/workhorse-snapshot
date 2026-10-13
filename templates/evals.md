# Evals: {{title}}

Change id: `{{change_id}}`
Spec: [spec.md](./spec.md)

Evals turn "does it work" into evidence. Each case is executable where the stack allows it and
becomes a permanent test. Targets are numbers.

## Targets

| Category | Target | Rationale |
|----------|--------|-----------|
| Golden | 100% pass | Core behaviour the outcome depends on |
| Edge | 100% pass | Boundaries, empty, max, unicode, concurrency |
| Failure | 100% correct handling | Dependencies down, bad input, timeouts |
| Adversarial | 100% rejected | Injection, authz bypass, oversized input |
| Non-functional | see rows | Latency, cost, throughput where relevant |

## Cases

| ID | Category | Given | When | Then | Maps to requirement | Implemented as |
|----|----------|-------|------|------|---------------------|----------------|
| E1 | golden | | | | R1 | tests/... |

## Side effects and records

Required at tier 2 and above. One row per call in this change that writes, sends, applies or
deletes something, and per approval, authorization or idempotency record it trusts. Each cell
names the case that proves it, or says why it cannot happen here. With neither kind in the
change, replace the table with `None: <why>`.

| Effect or record | Crash between effect and record | Effect fails or outcome unknown | Repeat of the same key | Verifying read fails | Replayed against another subject |
|------------------|---------------------------------|---------------------------------|------------------------|----------------------|----------------------------------|
| | | | | | |

## Non-functional

| ID | Measure | Target | How measured |
|----|---------|--------|--------------|
| N1 | p95 latency | | |

## Failure taxonomy

Named failure classes so incidents can be filed against them and become new evals.

| Class | Description | Detection | Example |
|-------|-------------|-----------|---------|
| | | | |
