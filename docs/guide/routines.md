# Routines

Applies to: Hearth Cloud and self-hosted Hearth.

Routines are repeatable AI workflows. They can run on schedules, webhooks, manual triggers, or chained outputs from other routines.

[[toc]]

## When to Use a Routine

Use a routine when the same work happens repeatedly:

- Daily standup summary.
- Weekly PR digest.
- Meeting prep from calendar and docs.
- Support feedback clustering.
- Launch readiness report.
- Alert triage.

## Routine Anatomy

A routine can include:

- Name and description.
- Prompt instructions.
- Scope: personal, team, or org.
- Schedule or event trigger.
- Integration mentions such as Slack, Notion, GitHub, Jira, or Google Calendar.
- Parameters.
- Approval gates.
- Delivery rules.
- Run-to-run state.
- Chain links to downstream routines.

## Templates

Templates provide useful starting points for common workflows. Customize the prompt, connected integrations, schedule, and delivery behavior before enabling the routine.

## State

Routine state lets Hearth compare new runs against previous runs. Use it for deltas, recurring reports, ongoing monitors, and "what changed since last time" workflows.

## Approval Gates

Approval gates pause a routine before an external action or sensitive delivery step. Use them for workflows that send messages, create tickets, update records, or publish reports.

## Health and Analytics

Admins can review routine health, alerts, top consumers, run history, and failures. For platform controls, see [Analytics](/admin/analytics) and the admin routine endpoints in the developer docs.
