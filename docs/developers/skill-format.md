# SKILL.md Format

Every skill is a markdown file with YAML frontmatter and structured sections. This page documents the complete format specification.

## File Location

```
agent-skills/skills/<skill-name>/SKILL.md
```

The directory name should match the skill's `name` field in the frontmatter. Use lowercase kebab-case: `code-review-and-quality`, `test-driven-development`, `my-custom-skill`.

## Frontmatter

The YAML frontmatter block at the top of the file contains metadata:

```yaml
---
name: code-review-and-quality
description: Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
---
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier for the skill. Kebab-case, matches the directory name. |
| `description` | Yes | One to two sentences describing what the skill does and when to use it. This is used for skill discovery — the agent matches user intent against this description. |

### Writing Good Descriptions

The description is critical for skill discovery. Include:

- **What** the skill does (verb phrase)
- **When** to use it (trigger conditions)

Good:
```yaml
description: Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
```

Bad:
```yaml
description: Code review skill.
```

## Standard Sections

### Title and Overview

```markdown
# Code Review and Quality

## Overview

Multi-dimensional code review with quality gates. Every change gets reviewed
before merge — no exceptions.
```

The H1 title is the human-readable skill name. The Overview section provides a concise summary (2-3 sentences) of the skill's purpose and philosophy.

### When to Use

```markdown
## When to Use

- Before merging any PR or change
- After completing a feature implementation
- When another agent or model produced code you need to evaluate
- When refactoring existing code
- After any bug fix (review both the fix and the regression test)
```

Bullet list of concrete situations where this skill applies. The agent uses this to decide whether to activate the skill for the current task.

### Core Process

```markdown
## Core Process

### 1. Correctness

Does the code do what it claims to do?

- Does it match the spec or task requirements?
- Are edge cases handled?
- Are error paths handled?

### 2. Readability

Can another engineer understand this code without explanation?

- Are names descriptive?
- Is the structure logical?
```

The main body of the skill. This is the workflow the agent follows. Use numbered steps or subsections for sequential processes. Include checklists, decision criteria, and specific questions to ask.

### Common Rationalizations

```markdown
## Common Rationalizations

These sound reasonable but are almost always wrong:

- "It works, so it's fine" — Working code and good code are different things
- "I'll clean it up later" — Later never comes
- "It's just a small change" — Small changes compound into unmaintainable code
```

Patterns of reasoning the agent should recognize and reject. These prevent the agent from taking shortcuts that seem locally optimal but are globally harmful.

### Red Flags

```markdown
## Red Flags

- Function longer than 50 lines
- More than 3 levels of nesting
- Commented-out code committed to main
- No error handling on external calls
- Hardcoded secrets or configuration
```

Specific patterns that indicate a problem. When the agent encounters a red flag, it should stop and address it rather than proceeding.

### Verification

```markdown
## Verification

- [ ] All tests pass
- [ ] No new warnings or lint errors
- [ ] Edge cases have test coverage
- [ ] Error messages are actionable
- [ ] No regressions in existing functionality
```

Checklist the agent runs before considering the skill's work complete. Every item must pass.

## Supporting Files

A skill directory can contain additional files alongside SKILL.md:

```
agent-skills/skills/my-skill/
  SKILL.md          # Required: the skill definition
  templates/        # Optional: template files the skill references
  examples/         # Optional: example inputs/outputs
  references/       # Optional: reference material
```

Reference supporting files in the SKILL.md with relative paths:

```markdown
See `templates/pr-template.md` for the standard PR description format.
```

## Naming Conventions

| Convention | Example | Rule |
|---|---|---|
| Directory name | `code-review-and-quality` | Lowercase kebab-case |
| Frontmatter `name` | `code-review-and-quality` | Must match directory name |
| H1 title | `Code Review and Quality` | Title case, human-readable |
| Description | Starts with a verb phrase | "Conducts...", "Implements...", "Guides..." |

## Full Example

```markdown
---
name: database-migration-safety
description: Guides safe database migration authoring. Use when creating or reviewing Prisma migrations. Use when schema changes affect production data.
---

# Database Migration Safety

## Overview

Safe database migrations require careful planning. A bad migration can cause
downtime, data loss, or corrupt production state. This skill ensures every
migration is reviewed for safety before deployment.

## When to Use

- When creating a new Prisma migration
- When reviewing a migration authored by another developer
- When a migration touches tables with more than 100k rows
- When adding or removing columns, indexes, or constraints

## Core Process

### 1. Classify the Migration

Determine the risk level:

- **Safe:** Add nullable column, add index concurrently, add table
- **Moderate:** Add non-nullable column with default, rename column
- **Dangerous:** Drop column, drop table, change column type, backfill data

### 2. Review the Generated SQL

Always read the SQL Prisma generates. Never trust the schema diff alone.

- Does it use `ALTER TABLE ... ADD COLUMN` with a default?
- Does it create indexes with `CONCURRENTLY`?
- Are there any `DROP` statements?

### 3. Test Against Production-Size Data

- Run the migration against a database with realistic data volumes
- Measure lock duration and query impact
- Verify the rollback path works

## Common Rationalizations

- "The table is small" — Tables grow. Design for the future size.
- "We can fix it with another migration" — Two migrations is twice the risk.
- "Prisma handles it" — Prisma generates SQL. You must verify the SQL.

## Red Flags

- Any migration that drops a column without a deprecation period
- Non-concurrent index creation on tables over 10k rows
- Data backfill mixed with schema changes in one migration
- Missing rollback plan

## Verification

- [ ] Generated SQL reviewed manually
- [ ] Migration tested against production-size data
- [ ] Lock duration measured and acceptable
- [ ] Rollback path documented and tested
- [ ] No data loss scenarios identified
```
