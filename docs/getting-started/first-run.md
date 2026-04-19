# First Run / Setup Wizard

When you visit a fresh Hearth instance for the first time, a setup wizard guides you through the initial configuration. The wizard has three steps: creating an admin account, connecting an LLM provider, and confirming that everything is ready. You cannot skip the wizard -- it must be completed before the main application becomes accessible.

## Step 1: Create Admin Account

The first screen asks you to create the initial administrator account and name your organization.

You will need to provide:

- **Full name** -- the display name used across the Hearth interface.
- **Email address** -- used for sign-in and notifications.
- **Password** -- must meet minimum strength requirements.
- **Organization name** -- the name of your team or company. This appears in the sidebar and is used to scope all data within the instance.

Once submitted, Hearth creates the organization and your admin user in a single transaction. You are automatically signed in and advanced to the next step.

## Step 2: Connect LLM Provider

Hearth requires at least one language model provider to power its AI features. This step lets you choose a provider, authenticate, and select a default model.

### Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude Sonnet, Claude Opus, Claude Haiku | Recommended for most teams. Requires an API key from [console.anthropic.com](https://console.anthropic.com). |
| **OpenAI** | GPT-4o, o3, o3-mini, o4-mini | Requires an API key from [platform.openai.com](https://platform.openai.com). |
| **Ollama** | Llama, Mistral, Qwen | Runs models locally -- no API key needed. Provide the Ollama server URL (defaults to `http://localhost:11434`). |

### Configuration Flow

1. **Choose a provider** from the list above.
2. **Enter credentials** -- paste your API key for Anthropic or OpenAI, or enter your Ollama server URL.
3. **Test connection** -- click the test button to verify that Hearth can reach the provider and that your credentials are valid. The wizard will not let you proceed until the test passes.
4. **Select default model** -- pick the model that Hearth should use by default for chat, routines, and agent tasks. You can change this later in **Admin > LLM Configuration**.

### Tips for Choosing a Provider

- **Fastest setup:** Anthropic or OpenAI. Paste a key and you are ready in seconds.
- **Privacy-first or air-gapped environments:** Use Ollama. All inference stays on your own hardware and no data leaves your network. Make sure the Ollama server is running and accessible from the machine hosting Hearth.
- **Cost considerations:** Smaller models (Claude Haiku, o4-mini, Qwen) are significantly cheaper per token than flagship models. They work well for routine tasks and digests. You can always add more providers and switch models later from the admin panel.
- **Multiple providers:** The wizard only requires one, but after setup you can add additional providers in **Admin > LLM Configuration** and assign different models to different features.

## Step 3: Setup Complete

After the LLM connection is verified, Hearth confirms that everything is configured and redirects you to the main application. From here you can:

- Start a conversation in the **Chat** page.
- Explore **Routines** to set up recurring AI-driven workflows.
- Invite team members from **Admin > Members**.
- Add more LLM providers or integrations from **Admin**.

If you need to change the LLM provider or admin settings later, everything configured during the wizard is accessible from the admin panel.
