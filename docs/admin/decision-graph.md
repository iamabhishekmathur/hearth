# Decision Graph Administration

Applies to: Hearth Cloud and self-hosted Hearth.

Decision Graph administration controls how Hearth captures, reviews, and reuses organizational decisions.

[[toc]]

## Admin Responsibilities

Admins and team leads should decide:

- Which teams should use decision capture.
- Who reviews auto-detected decisions.
- What sensitivity levels mean for the organization.
- Which domains matter for filtering and reporting.
- How outcomes should be recorded.
- Whether decision-derived principles should be fed into agent context.

## Decision Lifecycle

1. A decision is created manually or detected from chat or meeting context.
2. Hearth assigns metadata such as participants, domain, confidence, and sensitivity.
3. A reviewer confirms, edits, or dismisses the decision.
4. Dependencies and outcomes are added over time.
5. Patterns and principles can be synthesized from clusters of related decisions.

## Review Guidance

Reviewers should confirm:

- The decision actually happened.
- The title is clear.
- Reasoning and alternatives are accurate.
- Participants and source context are correct.
- Sensitivity is appropriate.
- Dependencies are not misleading.

## Sensitivity

Use sensitivity labels to keep confidential decisions from becoming casual context. Sensitive decisions should be reviewed more carefully before they are used by the agent in future conversations.

## Related Docs

- [Decision Graph](/guide/decisions)
- [Audit Logs](/admin/audit-logs)
- [Developers: Decisions API](/developers/api/decisions)
