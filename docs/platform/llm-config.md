# LLM Configuration

Configure AI providers and models for your organization. Requires the **admin** role.

## Overview

LLM Configuration controls which AI providers and models power Hearth. The platform supports three providers -- Anthropic, OpenAI, and Ollama (self-hosted) -- each with multiple model options. Admins set a default provider and model for the organization, store API keys securely, and can test connections before committing changes. The configuration applies immediately without requiring a restart.

## Key Concepts

- **Provider** -- An AI service that hosts language models. Hearth supports Anthropic, OpenAI, and Ollama.
- **Model** -- A specific AI model within a provider (e.g., Claude Sonnet 4.6, GPT-4o). Different models offer different tradeoffs between speed, quality, and cost.
- **Default Provider / Model** -- The organization-wide provider and model used for all conversations unless overridden by a user request.
- **API Key** -- The credential used to authenticate with a provider. Keys are encrypted with AES-256-GCM before storage. Keys can also be supplied via environment variables.
- **Key Source** -- Each provider shows where its key comes from: **db** (saved through the admin panel) or **env** (loaded from an environment variable). Environment variable keys are marked with an "env" badge.
- **Embedding Model** -- A separate model configuration used for generating vector embeddings (used by memory search and semantic similarity features).
- **Vision Support** -- Some models can process images. The vision toggle controls whether image analysis is available in chat.

## Supported Providers and Models

### Anthropic

| Model | Model ID | Vision |
|-------|----------|--------|
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Yes |
| Claude Opus 4.6 | `claude-opus-4-6` | Yes |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Yes |

### OpenAI

| Model | Model ID | Vision |
|-------|----------|--------|
| GPT-4o | `gpt-4o` | Yes |
| GPT-4o Mini | `gpt-4o-mini` | Yes |
| o3 | `o3` | No |
| o3-mini | `o3-mini` | No |
| o4-mini | `o4-mini` | Yes |

### Ollama (Self-Hosted)

Ollama runs models locally on your infrastructure. The model list is dynamic -- any model pulled into your Ollama instance is available. Common choices include:

- Llama 3.2, Llama 3.1
- Mistral
- Qwen 2.5

Ollama is configured via the `OLLAMA_BASE_URL` environment variable rather than an API key.

## How To

### View current configuration

1. Go to **Settings > LLM Config**.
2. The page shows provider cards for Anthropic, OpenAI, and Ollama.
3. Each card displays whether the provider is configured, the key source (db or env), and the available models.
4. The current default provider and model are highlighted.

### Set up a provider

1. Go to **Settings > LLM Config**.
2. Expand the provider card you want to configure (e.g., Anthropic).
3. Enter the API key for that provider.
4. Click **Test** to verify the connection works.
5. Click **Save** to store the encrypted key.
6. The provider card now shows "configured" status.

### Choose the default provider and model

1. Go to **Settings > LLM Config**.
2. Select a **default provider** from the configured providers.
3. Select a **default model** from the models available for that provider.
4. Click **Save**. The change applies immediately to all new conversations.

### Toggle vision support

1. Go to **Settings > LLM Config**.
2. Find the **Vision** toggle.
3. Enable or disable vision support. When enabled, users can send images in chat and the AI will analyze them.
4. Vision requires a vision-capable model (see the tables above).

### Check embedding status

1. Go to **Settings > LLM Config**.
2. The embedding section shows the current embedding provider and its status.
3. Embeddings are used for memory search and semantic similarity. They are configured separately from the conversation model.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/llm-config` | Get current default provider, model, and vision setting |
| PUT | `/api/v1/admin/llm-config` | Update default provider, model, and vision setting |
| GET | `/api/v1/admin/llm-config/providers` | List all providers with configured status and available models |
| GET | `/api/v1/admin/llm-config/embedding` | Get embedding provider status |
| POST | `/api/v1/admin/llm-config/keys` | Save an encrypted API key for a provider |

## Tips

- Start with one provider. You do not need to configure all three. Most teams begin with Anthropic or OpenAI and add others later.
- Always click **Test** before saving a new API key. This catches typos and permission issues immediately.
- API keys entered through the admin panel are encrypted with AES-256-GCM. If you prefer, you can set keys via environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`) instead. Environment-sourced keys are shown with an "env" badge and cannot be edited through the UI.
- Model selection follows a hierarchy: if a user specifies a model in their request, that takes precedence over the org default. Otherwise the org default is used.
- Ollama is a good choice for teams that need to keep data on-premises. Install Ollama on your infrastructure, pull your preferred models, and set `OLLAMA_BASE_URL` to point at it.
- Changes to the default provider and model take effect immediately. The provider registry is hot-reloaded -- no server restart is needed.
- The Settings page supports deep-linking: navigate directly with `#/settings/llm`.

## Related

- [First Run](/getting-started/first-run) -- LLM configuration is part of the initial setup process.
- [Integrations](./integrations) -- Integrations provide tools the AI uses alongside the configured LLM.
- [Analytics](./analytics) -- Track token consumption and costs per provider.
- [Soul & Identity](./soul-and-identity) -- Customize how the AI communicates, regardless of which model is powering it.
