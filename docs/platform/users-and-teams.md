# Users & Teams

Manage user accounts, assign roles, and organize people into teams. Requires the **admin** role.

## Overview

Users & Teams is where admins control who has access to Hearth and how they are organized. Every person in the platform has one of three roles -- admin, team lead, or member -- which determines what they can see and do. Teams group users together for shared context and collaboration.

## Key Concepts

- **Roles** -- Hearth has three user roles:
  - **admin** -- Full platform control. Can manage all users, teams, integrations, LLM configuration, governance policies, and compliance settings.
  - **team_lead** -- Can manage their own team's membership and team-level memory. Cannot access platform-wide admin settings.
  - **member** -- Standard access. Can use chat, routines, skills, and memory but cannot manage other users or teams.
- **User** -- An individual account identified by name, email, and role. Users belong to an organization and optionally to one or more teams.
- **Team** -- A named group of users. Each team can have a designated lead and any number of members. Teams share context that the AI can reference during conversations.
- **Deactivation** -- Admins can deactivate a user account without deleting it. Deactivated users cannot log in but their data (messages, memory, audit trail) is preserved.

## How To

### View all users

1. Go to **Settings > Users**.
2. The user list displays all accounts in your organization with their name, email, and role.
3. Use the search field to filter by name or email.
4. Results are paginated -- use the page controls at the bottom to navigate.

### Create a new user

1. Go to **Settings > Users**.
2. Click the **Add User** button.
3. Fill in the required fields: name, email, and role (admin, team_lead, or member).
4. Click **Save**. The user receives login credentials.

### Edit a user

1. Go to **Settings > Users**.
2. Find the user in the list and click their row to expand the edit controls.
3. Change the role using the dropdown, or update their name.
4. Click **Save** to apply the changes.

### Deactivate a user

1. Go to **Settings > Users**.
2. Find the user and click the delete/deactivate action on their row.
3. Confirm the action. The user is deactivated and can no longer log in.
4. Their historical data remains intact for audit and compliance purposes.

### View all teams

1. Go to **Settings > Teams**.
2. The team list shows each team's name and member count.

### Create a new team

1. Go to **Settings > Teams**.
2. Click the **Create Team** button.
3. Enter a team name.
4. Click **Save**. The team is created with no members.

### Assign members to a team

1. Go to **Settings > Teams** and select the team you want to manage.
2. Use the member assignment controls to add or remove users.
3. Designate a team lead by selecting the lead role for one of the members.
4. Click **Save** to apply the changes.

### Delete a team

1. Go to **Settings > Teams**.
2. Find the team you want to remove and click the delete action.
3. Confirm the deletion. Members are not deleted -- they simply no longer belong to that team.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/users` | List all users (paginated, filterable) |
| PATCH | `/api/v1/admin/users/:id` | Update a user's role or details |
| DELETE | `/api/v1/admin/users/:id` | Deactivate or remove a user |
| GET | `/api/v1/admin/teams` | List all teams |
| POST | `/api/v1/admin/teams` | Create a new team |
| PATCH | `/api/v1/admin/teams/:id` | Update team name or membership |
| DELETE | `/api/v1/admin/teams/:id` | Delete a team |

## Tips

- Assign the team_lead role to people who need to manage their own team without having full admin access. Team leads can manage team membership and team-level memory.
- Deactivating a user is safer than deleting them. Deactivated accounts preserve the audit trail and can be reactivated later if needed.
- Use teams to mirror your real organizational structure. The AI uses team context to provide more relevant responses to team members.
- The user list supports deep-linking: navigate directly with `#/settings/users`.

## Related

- [Soul & Identity](./soul-and-identity) -- Personalize how the AI communicates with individual users and the organization.
- [Governance](./governance) -- Control what the AI can do across the platform.
- [SSO](./sso) -- Enable single sign-on so users authenticate through your identity provider.
- [Audit Logs](./audit-logs) -- Track user creation, role changes, and team modifications.
