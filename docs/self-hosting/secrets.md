# Secrets

Self-hosted operators are responsible for generating, storing, rotating, and protecting deployment secrets.

[[toc]]

## Generate Required Secrets

```bash
openssl rand -base64 32
```

Use this for `SESSION_SECRET`.

```bash
openssl rand -hex 32
```

Use this for `ENCRYPTION_KEY`. The value must be 64 hex characters.

## Secret Storage

Use a secret manager where possible:

- Kubernetes Secrets sealed or managed by your cloud provider.
- AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, or similar.
- Environment injection from your deployment platform.

Avoid committing `.env` files or values to source control.

## Integration Tokens

Hearth encrypts integration credentials with `ENCRYPTION_KEY`. If you lose this key, stored encrypted credentials may become unrecoverable. If the key is leaked, rotate integration credentials after rotating the key.

## Rotation

Plan rotation for:

- `SESSION_SECRET`.
- `ENCRYPTION_KEY`.
- LLM provider keys.
- OAuth client secrets.
- Slack signing secret.
- Database credentials.
- Redis password.
- SMTP credentials.
- Integration tokens.

Test rotation in a staging environment before production.
