# Audit Logs

Applies to: Hearth Cloud and self-hosted Hearth.

Audit logs help admins inspect security-sensitive and administrative events.

[[toc]]

## What to Review

Use audit logs to investigate:

- User and role changes.
- Team changes.
- Integration changes.
- LLM provider changes.
- SSO changes.
- Governance and compliance changes.
- Cognitive profile setting changes.
- Sensitive admin actions.

## Investigation Flow

1. Filter by time range.
2. Filter by actor, target, or event type.
3. Inspect the event metadata.
4. Compare with user reports, governance violations, and integration health.
5. Export logs if needed for internal review.

## Retention

Retention policy can differ by edition and deployment. For Hearth Cloud, confirm retention in the current agreement or security documentation. For self-hosted deployments, retention depends on database policy and operator practices.

## API Reference

See [Admin Endpoints](/developers/api/admin).
