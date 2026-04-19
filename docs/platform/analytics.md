# Analytics

Organization-wide usage metrics, feature adoption, and cost tracking. Requires the **admin** role.

## Overview

Analytics gives admins visibility into how the organization is using Hearth. The dashboard covers user activity, message volumes, feature adoption, token consumption by provider, and session statistics. All data is scoped to your organization and configurable by time range, with a default window of 30 days.

## Key Concepts

- **Active Users** -- The number of distinct users who sent at least one message or performed an action within the selected time range.
- **Sessions** -- Chat conversation threads created during the period. Tracks how many conversations are being started and how long they last.
- **Messages** -- Total messages sent (both user and AI messages). Provides a measure of overall platform engagement.
- **Token Consumption** -- The number of tokens used across all LLM providers. Broken down by provider and model to help track costs.
- **Feature Adoption** -- Which platform features (chat, skills, routines, memory, integrations) are being used and by how many users. Helps identify underutilized capabilities.
- **Cost Tracking** -- Estimated costs per provider based on token consumption and model pricing. Useful for budgeting and identifying high-consumption patterns.
- **Time Range** -- All metrics accept a configurable time range specified in days. The default is 30 days.

## How To

### View the analytics dashboard

1. Go to **Settings > Analytics** (admin role required).
2. The dashboard displays summary cards for key metrics: active users, sessions created, messages sent, and tasks completed.
3. Scroll down for detailed breakdowns of token usage, feature adoption, and activity trends.

### Adjust the time range

1. On the analytics dashboard, find the time range selector.
2. Choose a preset (7 days, 30 days, 90 days) or enter a custom number of days.
3. The dashboard refreshes to show metrics for the selected period.

### Review token consumption

1. On the analytics dashboard, find the token usage section.
2. View total tokens consumed, broken down by provider (Anthropic, OpenAI, Ollama) and model.
3. Use this data to understand cost drivers and optimize model selection.

### Track feature adoption

1. On the analytics dashboard, find the feature adoption section.
2. See which features are being used: chat sessions, skill invocations, routine runs, memory operations, and integration tool calls.
3. Identify features that are underutilized and may need more team training or promotion.

### Query analytics via API

Use the analytics endpoint to retrieve metrics programmatically:

```
GET /api/v1/admin/analytics?days=30
```

The `days` query parameter controls the time range (defaults to 30). The response includes all metric categories in a single payload.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/analytics?days=N` | Get usage analytics for the last N days (default: 30) |

## Tips

- Check analytics weekly to stay on top of usage trends. Sudden spikes in token consumption may indicate a misconfigured routine or an unusually active user.
- Use feature adoption data to guide onboarding. If most of your team is using chat but nobody has set up routines, that is a training opportunity.
- Token consumption is the primary cost driver. If costs are higher than expected, review which models are being used most -- switching from a larger model (e.g., Claude Opus 4.6) to a smaller one (e.g., Claude Haiku 4.5) for routine tasks can significantly reduce costs.
- The analytics API returns all metrics in a single call, making it easy to build custom dashboards or feed data into external reporting tools.
- The Settings page supports deep-linking: navigate directly with `#/settings/analytics`.

## Related

- [Audit Logs](./audit-logs) -- While analytics shows aggregated metrics, audit logs provide the detailed event-level trail.
- [LLM Config](./llm-config) -- Model selection directly impacts token consumption and costs tracked in analytics.
- [Routines](/guide/#chat) -- Automated routines are a significant source of token usage. Monitor their consumption in analytics.
