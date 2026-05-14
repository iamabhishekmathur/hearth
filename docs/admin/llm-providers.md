# LLM Providers

Applies to: Hearth Cloud and self-hosted Hearth.

LLM provider configuration controls which models power chat, task planning, task execution, routines, memory synthesis, embeddings, and vision features.

[[toc]]

## Supported Provider Types

Hearth supports provider-backed configuration for:

- Anthropic.
- OpenAI.
- Ollama for local or self-managed models.
- OpenAI-compatible endpoints where implemented by the deployment.

Provider availability can differ by edition and deployment configuration.

## Setup Flow

1. Open **Settings > LLM Config**.
2. Choose a provider.
3. Add credentials or confirm environment-sourced credentials.
4. Test the provider connection.
5. Pick a default provider and model.
6. Confirm embedding and vision behavior.
7. Save the configuration.

## Key Sources

Keys can be supplied through:

- Admin UI storage, encrypted before persistence.
- Environment variables in self-hosted deployments.
- Cloud-managed workspace configuration where supported.

Environment-sourced keys cannot be edited from the UI.

## Embeddings

Embeddings support semantic memory search and similarity features. Confirm that at least one configured provider supports embeddings before relying on memory-heavy workflows.

## Vision

Vision support lets Hearth analyze images and screenshots in chat and task context. It requires a vision-capable provider and model.

## Compliance Interaction

Compliance packs can scrub sensitive values before text reaches external model providers. See [Compliance](/admin/compliance).

Governance policies can also monitor or block prompts before completion. See [Governance](/admin/governance).

## Self-Hosted Notes

Self-hosted deployments can configure providers with `.env` variables such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `OLLAMA_BASE_URL`. See [Configuration](/self-hosting/configuration).
