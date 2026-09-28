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

## Non-functional

| ID | Measure | Target | How measured |
|----|---------|--------|--------------|
| N1 | p95 latency | | |

## Failure taxonomy

Named failure classes so incidents can be filed against them and become new evals.

| Class | Description | Detection | Example |
|-------|-------------|-----------|---------|
| | | | |
