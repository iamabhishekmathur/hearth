# Compliance

Applies to: Hearth Cloud and self-hosted Hearth.

Compliance packs detect and scrub sensitive data before it reaches external model providers.

[[toc]]

## Available Pack Categories

Hearth includes pack support for common sensitive-data families:

- PII.
- PCI.
- PHI.
- GDPR.
- FERPA.
- Financial data.

Each pack can include multiple detectors and validation rules.

## How Scrubbing Works

When enabled, compliance checks can replace sensitive values with placeholders before provider calls. Hearth can then restore values where appropriate so users see useful responses while the model provider sees scrubbed content.

## Setup Flow

1. Open **Settings > Compliance**.
2. Review available packs.
3. Enable the packs that match your organization's risk.
4. Test sample text.
5. Review detected entities and placeholders.
6. Choose audit level.
7. Monitor stats and tune configuration.

## Governance vs Compliance

| Control | Use it for |
|---|---|
| Governance | Policy enforcement, warnings, blocks, review queues, and exports. |
| Compliance packs | Sensitive-data detection and scrubbing at provider boundaries. |

Most teams should use both.

## Limitations

No detector is perfect. Treat compliance packs as a guardrail, not a replacement for user training, access controls, DLP strategy, legal review, or security review.

## API Reference

See [Admin Endpoints](/developers/api/admin).
