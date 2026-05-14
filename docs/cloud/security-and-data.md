# Cloud Security and Data

Hearth Cloud runs the Hearth application as a managed workspace. Workspace admins still control users, integrations, model-provider behavior, governance, compliance packs, sharing, and audit review.

Exact contractual commitments such as data residency, retention, recovery objectives, and support targets should be confirmed in the current customer agreement.

[[toc]]

## Shared Security Controls

The cloud and self-hosted editions share the same product-level controls:

- Role-based access through users and teams.
- Session-based authentication.
- SSO configuration where enabled.
- Encrypted integration credentials.
- LLM provider configuration.
- Governance policies with monitor, warn, and block enforcement.
- Compliance packs for sensitive-data detection and scrubbing.
- Audit logs for admin and security review.

See the [Admin Guide](/admin/) for setup details.

## Responsibility Model

| Responsibility | Hearth Cloud | Your organization |
|---|---|---|
| Application hosting | Operates the hosted application. | Uses the workspace. |
| Database and cache operations | Operates hosted data stores. | Defines workspace usage and retention requirements. |
| Users and roles | Provides product controls. | Invites users, assigns roles, and reviews access. |
| LLM providers | Provides supported configuration paths. | Chooses providers and approves data-processing terms. |
| Integration credentials | Provides encrypted storage path. | Supplies, scopes, and rotates credentials. |
| Governance policies | Provides policy engine. | Defines rules and reviews violations. |
| Compliance packs | Provides detection and scrubbing controls. | Enables packs and validates behavior for your use case. |
| Audit review | Provides audit-log features. | Reviews logs and exports when needed. |

## Data Flow to Model Providers

Hearth sends prompts and relevant context to the configured LLM provider. Depending on workspace configuration, governance and compliance checks can inspect, warn, block, or scrub content before provider calls.

Admins should confirm:

- Which model providers are enabled.
- Whether provider keys are workspace-owned or managed through another agreement.
- Whether compliance packs are enabled before external model calls.
- Whether sensitive integrations require additional approval before connection.

## Security Review Checklist

Before broad rollout:

1. Confirm admins and team leads.
2. Enable SSO if required.
3. Review sharing defaults for chat sessions.
4. Connect only the integrations needed for the pilot.
5. Enable relevant compliance packs.
6. Start governance policies in monitor mode.
7. Review audit logs after initial setup.
8. Confirm export, deletion, retention, and offboarding requirements.

## Related Docs

- [Users and Teams](/admin/users-and-teams)
- [SSO](/admin/sso)
- [Integrations](/admin/integrations)
- [Governance](/admin/governance)
- [Compliance](/admin/compliance)
- [Audit Logs](/admin/audit-logs)
