# Governance

Applies to: Hearth Cloud and self-hosted Hearth.

Governance policies monitor AI usage and can notify, warn, or block risky behavior.

[[toc]]

## Enforcement Modes

| Mode | Behavior |
|---|---|
| Monitor | Log the violation without interrupting the user. |
| Warn | Notify the user while allowing the action. |
| Block | Prevent the action and explain the policy issue. |

## Rule Types

Governance policies can use:

- Keyword rules.
- Regular expressions.
- LLM-based semantic evaluation.

Use simple deterministic rules for high-confidence patterns and semantic rules for fuzzy policy areas.

## Common Policies

- Do not paste customer secrets.
- Block personal data in prompts to external providers.
- Warn before sharing confidential financial information.
- Monitor requests involving unreleased roadmap details.
- Require review before external publication.

## Workflow

1. Start in monitor mode.
2. Review violations and false positives.
3. Tune rules.
4. Move high-confidence rules to warn or block.
5. Export violations when needed for audit review.

## Related Controls

- [Compliance](/admin/compliance) for data detection and scrubbing.
- [Audit Logs](/admin/audit-logs) for admin/security events.
- [Skills](/guide/skills) for reusable governed workflows.
