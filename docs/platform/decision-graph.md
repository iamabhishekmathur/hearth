# Decision Graph

The Decision Graph captures organizational decisions, extracts patterns, and distills principles — building a living framework of how your organization makes decisions.

[[toc]]

## Overview

Every organization makes thousands of decisions — in chat, meetings, Slack threads, and email. Most are never recorded. The Decision Graph changes that by:

1. **Auto-detecting** decisions from conversations and meeting transcripts
2. **Recording** what was decided, why, by whom, and what alternatives were considered
3. **Linking** related decisions into a navigable graph
4. **Extracting patterns** from clusters of similar decisions
5. **Distilling principles** that feed back into the AI's context

## Admin Settings

Navigate to **Settings → Decision Graph** to configure:

### Auto-Extract from Chat

When enabled, Hearth monitors conversations for decision language (e.g., "we decided to...", "let's go with...") and automatically captures decisions. High-confidence detections are saved directly; lower-confidence ones appear in the review queue for human validation.

### Pattern Synthesis

A nightly job (2am UTC) analyzes decision clusters per domain and extracts recurring patterns. Domains with 3+ active decisions in the last 90 days are processed. Patterns progress from **emerging** (2-3 supporting decisions) to **established** (4+).

### Principle Distillation

For domains with 3+ established patterns, an LLM distills high-level organizational principles. Principles are created with **proposed** status and require admin endorsement to become **active**. Active principles are injected into the agent's system prompt.

### Meeting Ingestion

Meeting notes from Granola, Otter.ai, Fireflies.ai, or manual upload are processed to extract decisions. Webhooks from these providers are normalized and queued for extraction.

## Decision Lifecycle

| Status | Description |
|--------|-------------|
| `draft` | Auto-detected, needs human review |
| `active` | Confirmed and in effect |
| `superseded` | Replaced by a newer decision |
| `reversed` | Explicitly undone |
| `archived` | No longer relevant |

## Confidence Levels

| Level | Auto-capture behavior |
|-------|----------------------|
| `high` (>= 0.85) | Saved as `active` automatically |
| `medium` (0.6-0.85) | Saved as `draft`, user prompted to review |
| `low` (< 0.6) | Skipped, or agent asks "want me to capture this?" |

## Sensitivity

Decisions can be marked as:
- **normal** — visible to all org members
- **restricted** — visible to participants and admins
- **confidential** — visible only to the creator and admins

## Background Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Decision Extraction | On-demand (post-session) | Extract decisions from chat conversations |
| Meeting Ingestion | On-demand (webhook/upload) | Extract decisions from meeting transcripts |
| Staleness Check | Daily at 3am UTC | Flag decisions >180 days old with no outcomes |
| Pattern Synthesis | Nightly at 2am UTC | Extract patterns and distill principles |

## Activity Feed Integration

Decision events (`decision_captured`) appear in the Activity Feed. Proactive signals alert users to stale decisions that need outcome review.
