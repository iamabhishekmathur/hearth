# Skill Examples

This page shows real patterns from Hearth's built-in skills. Use these as templates when writing your own.

## Pattern: Multi-Axis Review

The `code-review-and-quality` skill reviews code across five independent axes. This pattern works for any evaluation that has multiple dimensions.

```markdown
---
name: code-review-and-quality
description: Conducts multi-axis code review. Use before merging any change.
---

# Code Review and Quality

## Overview

Multi-dimensional code review with quality gates. Every change gets reviewed
before merge — no exceptions. Review covers five axes: correctness, readability,
architecture, security, and performance.

**The approval standard:** Approve a change when it definitely improves overall
code health, even if it isn't perfect. Perfect code doesn't exist — the goal is
continuous improvement.

## The Five-Axis Review

### 1. Correctness
Does the code do what it claims to do?
- Does it match the spec or task requirements?
- Are edge cases handled (null, empty, boundary values)?
- Are error paths handled (not just the happy path)?

### 2. Readability & Simplicity
Can another engineer understand this code without the author explaining it?
- Are names descriptive and consistent with project conventions?
- Is the code structure logical (no deep nesting, no god functions)?

### 3. Architecture & Design
Does this change fit the existing codebase?
- Does it follow established patterns?
- Are abstractions at the right level?
- Will this be easy to modify in 6 months?

### 4. Security
Could this code be exploited?
- Input validation on all external data?
- SQL injection, XSS, CSRF protection?
- Secrets properly managed?

### 5. Performance
Will this code perform acceptably at expected scale?
- N+1 queries?
- Unnecessary database calls in loops?
- Large payloads without pagination?
```

**Key pattern:** Each axis is independent. The agent evaluates all five, then produces a combined assessment. A failure in any axis blocks approval.

## Pattern: Red-Green-Refactor Cycle

The `test-driven-development` skill encodes a strict sequential process. This pattern works for any workflow with a clear step order.

```markdown
---
name: test-driven-development
description: Implements features using the red-green-refactor TDD cycle. Use when building new features or fixing bugs where the expected behavior can be specified upfront.
---

# Test-Driven Development

## Core Process

### RED: Write a Failing Test

Before writing any implementation code:

1. Identify the behavior to implement
2. Write a test that asserts the expected behavior
3. Run the test — it MUST fail
4. If it passes, your test is wrong (testing something that already exists)

### GREEN: Make It Pass

Write the minimum code to make the failing test pass:

1. Implement only what the test requires — nothing more
2. Run the test — it MUST pass
3. Run the full test suite — no regressions

### REFACTOR: Clean Up

With passing tests as your safety net:

1. Remove duplication
2. Improve naming
3. Simplify logic
4. Run the full test suite after each change — tests MUST still pass

## Common Rationalizations

- "I'll write the tests after" — Tests written after implementation
  test what you built, not what you should have built
- "This is too simple to test" — Simple things become complex.
  The test documents the expected behavior.
- "TDD slows me down" — TDD slows the first hour and saves the next week
```

**Key pattern:** Each step has a mandatory verification (test MUST fail, test MUST pass). The agent cannot skip to the next step without the verification passing.

## Pattern: Checklist with Decision Points

The `shipping-and-launch` skill combines a linear checklist with conditional branches. This pattern works for release processes and deployment workflows.

```markdown
---
name: shipping-and-launch
description: Pre-launch checklist and release process. Use before deploying any change to production. Use when cutting a release.
---

# Shipping and Launch

## Pre-Ship Checklist

### Code Quality
- [ ] All tests pass (unit, integration, e2e)
- [ ] No lint warnings or errors
- [ ] Code review completed and approved
- [ ] No TODO comments referencing this release

### Security
- [ ] No secrets in code or environment files committed
- [ ] Dependencies scanned for known vulnerabilities
- [ ] Auth/authz tested on all new endpoints

### Data
- [ ] Database migrations tested against production-size data
- [ ] Rollback migration prepared and tested
- [ ] No breaking changes to public APIs (or versioned appropriately)

### Observability
- [ ] New endpoints have structured logging
- [ ] Error paths log enough context to debug
- [ ] Key metrics tracked (latency, error rate)

## Release Decision

If all checklist items pass: proceed to deployment.
If any item fails: fix the issue and restart the checklist.
Do not ship with known failures — "we'll fix it in the next release" is not acceptable.
```

**Key pattern:** The checklist is exhaustive and binary — every item passes or fails. There is an explicit decision point that determines the next action.

## Pattern: Systematic Diagnosis

The `debugging-and-error-recovery` skill encodes a hypothesis-driven debugging methodology.

```markdown
---
name: debugging-and-error-recovery
description: Systematic debugging with hypothesis testing. Use when encountering unexpected behavior, errors, or test failures.
---

# Debugging and Error Recovery

## Core Process

### 1. Reproduce
Before debugging, confirm you can reliably trigger the issue:
- What are the exact steps to reproduce?
- What is the expected behavior?
- What is the actual behavior?
- Is it consistent or intermittent?

### 2. Isolate
Narrow down the problem space:
- Which component is responsible?
- What changed recently? (git log, deployment history)
- Does the issue exist in the previous version?

### 3. Hypothesize
Form a specific, testable hypothesis:
- "The bug is caused by X because Y"
- Design a test that would prove or disprove the hypothesis

### 4. Test
Run your test:
- If hypothesis confirmed → fix the root cause (not symptoms)
- If hypothesis disproven → return to step 2 with new information

### 5. Verify
After fixing:
- [ ] Original reproduction case now passes
- [ ] Regression test added
- [ ] No new failures introduced
- [ ] Root cause documented (not just the fix)
```

**Key pattern:** The process loops (step 4 can return to step 2). The agent tracks hypotheses and their outcomes, building understanding incrementally rather than guessing randomly.

## Writing Your Own

When creating a skill, pick the pattern that best matches your workflow:

| Pattern | Use When |
|---|---|
| **Multi-Axis Review** | Evaluating something across independent dimensions |
| **Sequential Cycle** | Strict step order with mandatory verification at each step |
| **Checklist with Decision** | Binary pass/fail gates leading to a go/no-go decision |
| **Systematic Diagnosis** | Investigating unknowns with iterative hypothesis testing |

Combine patterns as needed. The `incremental-implementation` skill, for example, combines a sequential cycle (plan, implement, verify) with a checklist (pre-commit checks) at each iteration.
