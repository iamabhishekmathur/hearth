# Activity Feed

Applies to: Hearth Cloud and self-hosted Hearth.

The Activity Feed is the cross-workspace timeline for work happening in Hearth.

[[toc]]

## What Appears

Activity can include:

- Task updates.
- Chat activity.
- Routine runs.
- Artifact changes.
- Decision events.
- Integration events.
- Governance-related events where visible.
- Proactive AI signals.
- Daily or periodic digests.

## Reactions

Users can react to activity entries. Reactions help teams mark what is useful, approved, confusing, risky, or worth revisiting.

## Proactive Signals

Hearth can surface patterns it detects across work: stale tasks, recurring blockers, repeated questions, unusual activity, or opportunities to create a skill or routine.

## Digests

Digests summarize recent activity for people who do not live in the feed. They are useful for team leads, admins, and operators monitoring broad adoption.

Each person gets at most **one** digest a day, at 9am in their timezone (UTC if none is set). It shows in the bell, and by email when email is set up. If you own memory or routines with [Review](/guide/review) cards waiting, the same digest carries one line about them — never a separate alert.

## Knowledge lines

When your organization has the knowledge loop on, the top of the Activity page can show:

- **For you:** "Your input improved N things this week." It appears only when your feedback led to an approved fix in the last 7 days. No bell, no email.
- **For admins:** a weekly card — how many items changed, how many proposals wait (and the oldest), and areas with no owner, such as a team with no team lead or an item whose owner left. Admins also get one line about it in Monday's digest.

You can turn each of these off in **Settings → Profile → Knowledge updates**.

## Notification settings

**Settings → Profile → Knowledge updates** (shown when the knowledge loop is on) has these switches:

| Switch | Default | What it controls |
|---|---|---|
| Daily review summary | On | The line in your digest when proposals wait, and the one 7-day reminder |
| Email the review summary | Off | Also send that line by email |
| Show how my input helped | On | The "Your input improved…" line on Activity |
| Weekly knowledge summary | On for admins | The admin card on Activity and the Monday digest line |

## Admin Use

Admins should use the Activity Feed alongside:

- [Analytics](/admin/analytics) for adoption patterns.
- [Audit Logs](/admin/audit-logs) for security-sensitive events.
- [Governance](/admin/governance) for policy enforcement.
