# Platform Administration

Configure and manage your Hearth deployment. Most features in this section require the **admin** role.

## Identity & Configuration

- **[Users & Teams](/platform/users-and-teams)** — Create accounts, assign roles (admin, team lead, member), and organize users into teams.
- **[LLM Configuration](/platform/llm-config)** — Set up AI providers (Anthropic, OpenAI, Ollama), choose models, test connections, and manage fallbacks.
- **[Soul & Identity](/platform/soul-and-identity)** — Define how the AI communicates via SOUL.md and IDENTITY.md documents at org and personal levels.

## Integrations

- **[Integrations](/platform/integrations)** — Connect Slack, Gmail, Google Drive, Jira, Notion, GitHub, and Google Calendar. Monitor health and manage OAuth credentials.

## Governance & Security

- **[Governance](/platform/governance)** — Define policies that monitor chat messages for compliance violations. Keyword, regex, and AI-powered semantic rules with monitor/warn/block enforcement. Violation dashboard, review workflow, trend analytics, and compliance export.
- **[Compliance](/platform/compliance)** — Automatic detection and scrubbing of sensitive data (PII, PCI-DSS, PHI, GDPR, FERPA, financial) before it reaches external LLM providers. Six built-in compliance packs with per-detector overrides, dry-run testing, and a 30-day stats dashboard.
- **[SSO](/platform/sso)** — Single sign-on configuration with SAML providers.
- **[Audit Logs](/platform/audit-logs)** — Comprehensive audit trail of all platform actions.

## Team Intelligence

- **[Digital Co-Worker](/platform/cognitive-profiles)** — Cognitive profiles extracted from chat conversations. Team members can `@mention` anyone in chat to ask "How would X think about this?" — grounded in observed patterns with cited evidence. Off by default, individual opt-out, full audit trail.

## Decision Intelligence

- **[Decision Graph](/platform/decision-graph)** — Capture organizational decisions from chat, meetings, and integrations. Auto-detect decision language, extract patterns from clusters, distill principles, and feed them back into the AI's context. Timeline explorer, graph view, review queue, and admin controls.

## Insights

- **[Analytics](/platform/analytics)** — Usage metrics, feature adoption, token consumption, and cost tracking.
- **[Routine Health](/platform/routine-health)** — Org-wide routine monitoring, per-routine analytics, and configurable health alerts for failure detection.
