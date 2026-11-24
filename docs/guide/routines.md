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

## History and Owners

Hearth keeps every version of a routine's definition: its name, prompt, schedule, delivery and parameters. Turning a routine on or off, and its run state, are not versions. An owner can restore an earlier version; Hearth saves the restore as a new version, so nothing is lost.

| Routine | Owners |
|---|---|
| Personal | The person who made it |
| Team | Admins and team leads on that team |
| Org | Admins |

An admin can also name one more owner. The AI can change your personal routines when you ask it to. It cannot change team or org routines; it tells you what it would change, and the owner makes the change.

When the knowledge loop is on, failed runs and outputs an owner had to rewrite can lead to a proposed new prompt in the owner's [Review Inbox](/guide/review). Only the prompt can change this way, and only when an owner approves.

## Health and Analytics

Admins can review routine health, alerts, top consumers, run history, and failures. For platform controls, see [Analytics](/admin/analytics) and the admin routine endpoints in the developer docs.
