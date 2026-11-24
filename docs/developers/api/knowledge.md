# Knowledge (Review Inbox)

The knowledge API serves the **Review inbox**: changes the nightly curator proposes to one memory entry or one routine prompt. Owners approve, edit or reject them. Nothing changes until an owner approves.

All routes need a session and an organization. They sit behind the org feature flag `knowledgeLoop` (off by default). **With the flag off, every route answers `404`.**

## Who sees a card

A card is visible only to an **owner of its target**, worked out at the moment you ask (so it follows role and team changes):

| Target | Owners |
|---|---|
| Org memory, org routine | Admins |
| Team memory, team routine | Admins and that team's team leads |
| Personal memory, personal routine | The person |
| Any target with a named owner | The named owner, in addition |

Anyone else — other members, viewers, other organizations — gets `404` for the card, as if it did not exist. A card also stays hidden until its `availableAt` time (see the daily cap below).

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/knowledge/proposals?status=` | Your cards that are due. `status` is `pending` (default), `approved`, `edited`, `rejected`, `superseded`, `dropped` or `all`. |
| `GET` | `/knowledge/proposals/:id` | One card with its evidence. |
| `POST` | `/knowledge/proposals/:id/approve` | Apply the change. Optional edited text. |
| `POST` | `/knowledge/proposals/:id/reject` | Turn it down. Optional reason. |
| `POST` | `/knowledge/curator/run` | Admins: run the curator for your org now. Returns counts only. |

### Card shape

```ts
interface KnowledgeProposal {
  id: string;
  targetType: "memory" | "routine";
  targetId: string;
  targetName: string;
  ownerLabel: string;          // "Admins", "Engineering leads and admins", "Ada"
  targetVersion: number;       // the target's version when proposed
  before: string;              // memory content, or the routine prompt
  after: string;               // the proposed text
  reason: string;              // plain sentences for the owner
  affected: { audience: "org" | "team" | "person"; teamName?: string; personName?: string;
              routines?: { id: string; name: string }[] };
  status: "pending" | "approved" | "edited" | "rejected" | "superseded" | "dropped";
  availableAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  editedAfter: string | null;  // the owner's text, for "edited"
  resultVersion: number | null; // the version the approval wrote
  createdAt: string;
  evidence: {
    counts: Record<string, number>;  // by signal kind
    people: number;                  // distinct people behind the signals
    items: {
      kind: string; source: string; createdAt: string;
      label: string;                 // "A member corrected an answer."
      quote: string | null;          // only if you can open the source
      link: { type: "session"; sessionId: string }
          | { type: "routine_run"; routineId: string; runId: string | null }
          | null;
    }[];
  };
}
```

**Evidence privacy.** A quote and a link appear only when you can open where the signal came from: your own signal, a chat you own, were added to, or that is shared with the org, or a routine you can view. Evidence from someone's private chat shows only its label, such as "A member corrected an answer."

A routine card only ever changes the **prompt**. Scope, team, owner, schedule and delivery are never part of a proposal.

### Approve

```json
POST /api/v1/knowledge/proposals/:id/approve
{ "after": "optional edited text", "baseVersion": 3 }
```

- With no body, the proposed text is applied. With `after` (and different text), your text is applied and the card is saved as `edited`.
- The change is saved as a new version with change source `curator`, made by you.
- `baseVersion` is only for after a conflict: it says which newer version you have looked at.

| Status | When |
|---|---|
| `200` | Applied. Returns the card. |
| `400` | Bad body (empty `after`, unknown field, bad `baseVersion`). |
| `404` | Not found, not yours, not due yet, or the flag is off. |
| `409` `version_conflict` | The target changed since the card was made. The body has `currentVersion` and `currentContent`. The card stays open; look at the new text and approve again with `baseVersion`. |
| `409` `already_decided` | Someone already decided this card. The body has its `status`. Two owners at once: one wins, the other gets this. |
| `410` `target_gone` | The memory entry or routine was deleted. The card is dropped. |

### Reject

```json
POST /api/v1/knowledge/proposals/:id/reject
{ "reason": "We still use #customers until Q1" }
```

`reason` is optional (at most 500 characters). Secrets are removed before it is saved. The curator reads recent reasons on its next run and will not propose the same fix again. Returns `200` with the card, or `404` / `409` as for approve.

### Run now (admins)

`POST /api/v1/knowledge/curator/run` runs the curator for your org at once and returns a summary such as `{ "signals": 6, "groups": 2, "modelCalls": 1, "proposed": 1, "attached": 1, ... }`. Members get `403`. With the flag off: `404`.

## How the curator works

The curator runs every night at 04:00 UTC (worker queue `knowledge-curator`), before the 04:30 signal cleanup, for each org with the flag on.

1. It reads the gap signals it has not used yet. **No new signals means no model call.**
2. It attaches each signal to one target: a signal from a routine run goes to that routine; a chat signal goes to the best-matching memory entry the signal's person can see. Signals with no plausible target wait (they expire after 90 days).
3. A target needs **at least two signals** before the curator asks the model for a fix.
4. If the target already has an open card, new signals join it instead of making a second card.
5. If an owner rejected a fix for the target in the last 30 days, only newer signals count, and the same fix is never offered again.
6. One model call per target (`claude-haiku-4-5-20251001`). Signal text is treated as untrusted data. The answer must be valid JSON with the full new text; a model error, a timeout, bad JSON, empty text, unchanged text, or a link or address that appears neither in the current text nor in any signal means **no card**, and the signals are tried again next night.
7. **Daily cap:** at most 5 new cards per owner per day. Extra cards show on the following days, in order.
8. If someone edits the target while its card is open, the card becomes `superseded` and its signals are looked at again against the new text. If the target is deleted, the card is `dropped`.

Every decision writes an audit log row: `knowledge_proposal_approved`, `knowledge_proposal_edited` or `knowledge_proposal_rejected` (ids and versions only, never content).

## Quality eval

`pnpm --filter @hearth/api curator:eval` runs the real curator prompt and model on 40 fixed cases and grades them with a pinned judge model (`claude-sonnet-4-5-20250929`). Pass marks: at least 20 of 25 real gaps fixed correctly, at least 9 of 10 noise cases with no proposal, 5 of 5 injection or conflicting-evidence cases safe, and no invented facts. A judge or model error counts as a failed case. It is not part of CI.
