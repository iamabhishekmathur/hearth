# Limits and Billing

Hearth Cloud plans and limits are managed outside the open-source runtime. Use this page to understand the categories that can affect a hosted workspace, then confirm exact values in your current plan or agreement.

[[toc]]

## Limit Categories

Cloud workspaces can be shaped by limits in these areas:

| Category | What it affects |
|---|---|
| Seats | Users who can access the workspace. |
| Workspaces | Number of organizations or environments under one account. |
| Messages | Chat volume, burst behavior, or rate limits. |
| Routines | Number of active routines, run frequency, webhook volume, and history retention. |
| Files | Upload size, total storage, attachment types, and file retention. |
| Integrations | Number of connected providers, OAuth apps, or custom MCP connectors. |
| Audit and analytics | Retention windows and export access. |
| Support | Available support channels and response targets. |

## LLM Usage

LLM usage depends on workspace configuration. Admins should confirm:

- Which providers are enabled.
- Whether provider credentials are supplied by the workspace, environment, or managed cloud configuration.
- Whether usage is billed by Hearth, by the external provider, or through another agreement.
- Whether model access differs by workspace or plan.

Do not assume that self-hosted provider-key behavior and cloud billing behavior are identical.

## Managing Usage

Admins can reduce unnecessary consumption by:

- Creating focused routines instead of overly broad monitors.
- Reviewing high-volume integrations.
- Using smaller models where quality is sufficient.
- Keeping task context focused.
- Disabling unused routines.
- Reviewing analytics for adoption and usage patterns.

## Changes to Plans

Before changing a plan, confirm:

- Whether limits change immediately or at renewal.
- Whether data retention changes.
- Whether exports are needed before downgrade or cancellation.
- Which users should remain active.
- Whether integrations or routines need cleanup.

## Related Docs

- [Cloud Workspace Setup](/cloud/workspace-setup)
- [Cloud Security and Data](/cloud/security-and-data)
- [Analytics](/admin/analytics)
