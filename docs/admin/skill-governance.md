# Skill Governance

Applies to: Hearth Cloud and self-hosted Hearth.

Skill governance lets admins review reusable AI workflows before they spread across the organization.

[[toc]]

## Why Govern Skills

Skills can encode powerful behavior: review patterns, launch processes, data-handling rules, research workflows, and integration-backed actions. Governance helps teams share useful patterns without accidentally standardizing risky ones.

## Review Signals

When reviewing a skill, check:

- The skill has a clear purpose and trigger.
- Instructions are specific enough to be repeatable.
- The skill does not ask the AI to bypass governance, compliance, or review gates.
- External actions are explicit.
- Sensitive data handling is described.
- Examples match the workflow.
- Ownership is clear.

## Recommended Workflow

1. Let users create or import candidate skills.
2. Review new skills before org-wide availability.
3. Approve trusted skills.
4. Disable or revise skills that cause poor outputs.
5. Turn repeated successful work into documented team skills.

## Relationship to Governance Policies

Skill governance controls reusable workflows. Governance policies still monitor messages and actions at runtime. Use both for high-sensitivity workflows.

## Related Docs

- [Skills](/guide/skills)
- [Governance](/admin/governance)
- [SKILL.md Format](/developers/skill-format)
