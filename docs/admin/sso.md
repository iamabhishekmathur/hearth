# SSO

Applies to: Hearth Cloud and self-hosted Hearth where SSO is enabled.

SSO lets organizations centralize authentication through an identity provider.

[[toc]]

## Supported Modes

Hearth has admin routes for SSO configuration and supports SAML or OIDC-style setup depending on deployment and provider configuration.

## Setup Checklist

1. Open **Settings** as an admin.
2. Collect identity provider metadata.
3. Configure SAML or OIDC values.
4. Save the configuration.
5. Test login with a non-admin account before requiring SSO broadly.
6. Keep a break-glass admin recovery path.

## Values to Confirm

Document these values for your identity provider:

- Entity ID or issuer.
- SSO URL.
- Certificate or JWKS URL.
- Callback URL.
- Allowed domains.
- Attribute mapping for email, name, and groups if used.

## Cloud Notes

For Hearth Cloud, use the callback URLs and settings provided for your workspace. Confirm support requirements and domain verification before enforcing SSO.

## Self-Hosted Notes

For self-hosted deployments, ensure `WEB_URL`, `API_URL`, and callback URLs match the public URL behind your reverse proxy or ingress.

## API Reference

See [Admin Endpoints](/developers/api/admin).
