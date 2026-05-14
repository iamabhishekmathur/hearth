# Cognitive Profiles

Applies to: Hearth Cloud and self-hosted Hearth.

Cognitive profiles, also called the Digital Co-Worker feature in the UI, let Hearth model how teammates tend to think and work. The feature is admin-controlled and users can opt out where enabled.

[[toc]]

## What It Enables

When enabled, Hearth can answer questions like:

```text
How would Maya approach this launch risk?
```

Responses should be grounded in observed patterns and evidence, not impersonation or private speculation.

## Admin Controls

Admins can:

- Enable or disable cognitive profiles for the organization.
- Explain the feature before rollout.
- Review auditability expectations.
- Pair the feature with governance and compliance controls.

## User Controls

Users can opt out from their account settings when the organization has enabled the feature. When disabled for a user, Hearth should stop extracting new patterns and hide that profile from coworker queries.

## Rollout Guidance

Start with a small group, explain the purpose clearly, and make opt-out behavior easy to find. Cognitive profiles are most useful when teams trust the system and understand how the model is grounded.

## API Reference

See [Chat and Sessions](/developers/api/chat) and [Admin Endpoints](/developers/api/admin).

## Related Docs

- [Soul and Identity](/admin/soul-and-identity)
- [Audit Logs](/admin/audit-logs)
