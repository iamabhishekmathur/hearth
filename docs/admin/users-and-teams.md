# Users and Teams

Applies to: Hearth Cloud and self-hosted Hearth.

Users and teams control who can access Hearth and which context they share.

[[toc]]

## Roles

| Role | Typical access |
|---|---|
| Admin | Full workspace administration, including users, teams, integrations, LLM config, governance, compliance, analytics, and audit logs. |
| Team lead | Team-level coordination and team context, without full platform administration. |
| Member | Standard product access for chat, tasks, routines, memory, skills, and collaboration. |
| Viewer | Read-oriented access where supported. |

## Teams

Teams group people for collaboration and context. Use teams to mirror real working groups, not just reporting lines. Team-scoped memory is most useful when team membership matches how people actually share knowledge.

## Common Tasks

1. Open **Settings > Users** to review accounts.
2. Add or invite users.
3. Assign each user a role.
4. Open **Settings > Teams**.
5. Create teams.
6. Add users to teams.
7. Periodically deactivate users who should no longer have access.

## Access Hygiene

- Keep the admin role small.
- Use team leads for delegated team management.
- Deactivate users instead of deleting history that may be needed for audit trails.
- Review roles after reorganizations.
- Review access after connecting sensitive integrations.

## API Reference

See [Admin Endpoints](/developers/api/admin) for user and team API details.
