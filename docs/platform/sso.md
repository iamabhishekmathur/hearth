# SSO

Single Sign-On configuration for your organization. Requires the **admin** role.

## Overview

SSO lets your team authenticate through your existing identity provider instead of managing separate Hearth credentials. Hearth supports both SAML and OIDC protocols. When SSO is configured, users are redirected to your identity provider to log in, and Hearth handles Just-In-Time (JIT) provisioning -- creating user accounts automatically on first SSO login so there is no manual account setup required.

## Key Concepts

- **SAML (Security Assertion Markup Language)** -- An XML-based protocol for exchanging authentication data between your identity provider (IdP) and Hearth. Common SAML providers include Okta, Azure AD, and OneLogin.
- **OIDC (OpenID Connect)** -- A modern JSON-based authentication protocol built on top of OAuth 2.0. Common OIDC providers include Google Workspace, Auth0, and Keycloak.
- **Identity Provider (IdP)** -- The external service that authenticates your users (e.g., Okta, Azure AD, Google Workspace). Your IdP holds the user directory and handles the actual login flow.
- **JIT Provisioning (Just-In-Time)** -- When a user logs in via SSO for the first time, Hearth automatically creates their account using the name and email from the SSO assertion. No admin needs to pre-create the account.
- **Organization Slug** -- A URL-friendly identifier for your organization (e.g., `acme-corp`). Used in the SSO check endpoint to determine whether SSO is configured for a given organization.
- **SSO Callback** -- The endpoint that receives the authentication assertion from your IdP after the user successfully logs in. Hearth validates the assertion and establishes a session.

## How To

### Configure SAML SSO

1. Go to **Settings > SSO** (admin role required).
2. Select **SAML** as the SSO type.
3. Enter the required SAML configuration from your identity provider:
   - **Entry point URL** -- The IdP's SSO login URL where users are redirected.
   - **Issuer** -- The entity ID of your IdP.
   - **Certificate** -- The IdP's public X.509 certificate for verifying SAML assertions.
4. Click **Save**. Hearth validates the required fields before saving.
5. In your identity provider, configure Hearth as a service provider:
   - **ACS URL (Assertion Consumer Service):** `https://your-hearth-domain/api/v1/auth/sso/callback`
   - **Entity ID:** Your Hearth instance URL.
   - **Name ID format:** Email address.

### Configure OIDC SSO

1. Go to **Settings > SSO** (admin role required).
2. Select **OIDC** as the SSO type.
3. Enter the required OIDC configuration:
   - **Issuer URL** -- The OIDC discovery endpoint (e.g., `https://accounts.google.com`).
   - **Client ID** -- The client ID from your OIDC provider.
   - **Client Secret** -- The client secret from your OIDC provider.
4. Click **Save**. Hearth validates the required fields before saving.
5. In your OIDC provider, configure the redirect URI as `https://your-hearth-domain/api/v1/auth/sso/callback`.

### Verify SSO is configured

Before directing users to log in via SSO, verify that SSO is configured for your organization:

```
GET /api/v1/auth/sso/check/:slug
```

The response indicates whether SSO is enabled and which protocol type (SAML or OIDC) is configured:

```json
{
  "data": {
    "enabled": true,
    "type": "saml"
  }
}
```

### Test SSO login

1. After configuring SSO, open a private/incognito browser window.
2. Navigate to your Hearth login page.
3. Enter your organization slug. If SSO is configured, you will be redirected to your identity provider.
4. Log in with your IdP credentials.
5. On success, you are redirected back to Hearth with an active session. If this is your first login, a new user account is created via JIT provisioning with the `member` role.

### Remove SSO configuration

1. Go to **Settings > SSO**.
2. Click **Remove SSO** or use the delete action.
3. Confirm the action. SSO is disabled and users must use standard Hearth authentication (email/password) to log in.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/sso` | Get the current SSO configuration |
| PUT | `/api/v1/admin/sso` | Save or update SSO configuration |
| DELETE | `/api/v1/admin/sso` | Remove SSO configuration |
| GET | `/api/v1/auth/sso/check/:slug` | Check if SSO is configured for an organization (public) |
| POST | `/api/v1/auth/sso/callback` | SSO callback -- handles SAML/OIDC assertion (called by IdP) |

## Tips

- Test SSO in an incognito window so you do not lose your admin session if something is misconfigured.
- JIT-provisioned users are created with the `member` role by default. After their first login, an admin can promote them to `team_lead` or `admin` via the [Users & Teams](./users-and-teams) page.
- The organization slug must be lowercase alphanumeric with hyphens only (e.g., `acme-corp`). It is used in the SSO check endpoint and the login flow.
- SAML assertions must be cryptographically verified. Ensure the certificate you enter in the configuration matches the one your IdP uses to sign assertions.
- If SSO login fails, check the following: (1) the ACS URL in your IdP matches your Hearth instance, (2) the certificate has not expired, (3) the name ID format is set to email address.
- Removing SSO does not delete user accounts that were created via JIT provisioning. Those users continue to exist and can log in with standard credentials if set up.

## Related

- [Users & Teams](./users-and-teams) -- Manage users created through JIT provisioning and adjust their roles.
- [Audit Logs](./audit-logs) -- SSO login events are recorded as `auth_login` entries in the audit trail.
- [Compliance](./compliance) -- SSO is often a compliance requirement. Enabling it centralizes authentication through your organization's identity provider.
