# Use Your ChatGPT Plan

Applies to: self-hosted Hearth with `CHATGPT_PLAN_ENABLED=true`. Hearth Cloud support depends on OpenAI approving Hearth as a hosted partner.

You can connect your own ChatGPT account so your chats in Hearth use your **ChatGPT plan** (Go, Plus, Pro, or Business) instead of your organization's API key. You keep signing in to Hearth the usual way (Google, email, or SSO). Connecting ChatGPT is a separate, per-person step.

[[toc]]

## Connect ChatGPT

1. Open **Settings → ChatGPT plan**.
2. Select **Continue with ChatGPT** and sign in to ChatGPT.
3. On the consent screen, allow Hearth to **use your ChatGPT plan**. If you only sign in without allowing plan usage, nothing is connected.
4. You return to Hearth. A one-time notice confirms *"You're using your ChatGPT plan."*

On self-hosted installs that use OpenAI's open-source flow, ChatGPT redirects back to `127.0.0.1`, so connect from the computer that runs Hearth.

## How Chats Use Your Plan

- While **Use my ChatGPT plan for my chats** is on, the composer shows **Using ChatGPT plan · Manage usage** in place of the model picker.
- Choose which ChatGPT model to use in **Settings → ChatGPT plan → Model**. The list comes from your ChatGPT account.
- In shared sessions, a message runs on the plan of the person who **sent** it.
- Background features (summaries, decision extraction, scheduled routines) still use your organization's configured models.

## Usage Limits

Requests count toward your ChatGPT plan limits. In ChatGPT you can set a weekly cap for Hearth.

When you hit a limit, Hearth **stops and tells you**. It does not quietly switch to your organization's API key. From the notice you can:

- **Manage usage**: open ChatGPT settings to review or raise your cap.
- **Use my organization's models instead**: turn the plan off for your chats.

## Disconnect

Use **Disconnect** in **Settings → ChatGPT plan**. Hearth revokes its access and deletes its copy of your tokens. You can also remove Hearth in ChatGPT under **Settings → Security and login → Sign in with ChatGPT**.

## Limitations

OpenAI's plan-usage preview does not support every feature. Image generation, hosted file search, Code Interpreter, and server-side conversation state aren't available through your plan. Hearth's own tools (function calling) work normally.
