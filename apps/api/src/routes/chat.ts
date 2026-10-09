import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentPart, LLMMessage, SessionVisibility } from '@hearth/shared';
import { requireAuth, requireOrg } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import * as chatService from '../services/chat-service.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToSession, emitToUser, emitToSessionEvent } from '../ws/socket-manager.js';
import {
  registerRun,
  unregisterRun,
  newRunId,
  requestStop,
  claimFinalize,
  getActiveRunsForSession,
} from '../agent/run-registry.js';
import { canStopRun } from '../services/run-permission.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import { logger } from '../lib/logger.js';
import { evaluateMessage, getGovernanceSettings, hasBlockPolicies } from '../services/governance-service.js';
import { reflectOnSession } from '../services/experience-service.js';
import { notify } from '../services/notification-service.js';
import { enqueueCognitiveExtraction } from '../jobs/cognitive-extraction-scheduler.js';
import { decisionExtractionQueue } from '../jobs/decision-extraction-scheduler.js';
import {
  isCognitiveEnabledForOrg,
  getCognitiveEnabled,
  setCognitiveEnabled,
} from '../services/cognitive-profile-service.js';
import { listCommands, resolveCommandForOrg } from '../services/command-service.js';
import { parseCommandInput, CommandResolveError } from '../services/command-registry.js';

const router: ReturnType<typeof Router> = Router();

/**
 * POST /sessions — create a new chat session
 */
router.post('/sessions', requireAuth, requireOrg, async (req, res, next) => {
  try {
    const { title } = req.body as { title?: string };
    const session = await chatService.createSession(req.user!.orgId!, req.user!.id, title);
    res.status(201).json({ data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /features — the current org's agent feature flags (W2–W6). Lets the chat
 * UI gate new interactive surfaces (e.g. the W2 Stop button / live input)
 * per-org. Returns all-false when there's no org context.
 */
router.get('/features', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: {} });
      return;
    }
    const { prisma } = await import('../lib/prisma.js');
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    const { getOrgFeatureFlags } = await import('../lib/feature-flags.js');
    res.json({ data: getOrgFeatureFlags(org?.settings) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /commands — the `/` command menu list for the current user's org (W6).
 *
 * Built-ins + the org's invocable skills. Gated behind the `slashCommands` flag;
 * when off (or no org) returns an empty list so the client shows no `/` menu.
 */
router.get('/commands', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    if (!isFeatureEnabled(org?.settings, 'slashCommands')) {
      res.json({ data: [] });
      return;
    }
    const commands = await listCommands(orgId);
    res.json({ data: commands });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /commands/resolve — resolve a `/slug args` skill command (W6).
 *
 * Only used for skill commands (built-ins dispatch client-side). Returns the
 * expanded prompt the client then sends as a normal message, OR a structured
 * inline error (422) — a bad command is NEVER forwarded to the agent as a prompt.
 */
router.post('/commands/resolve', requireAuth, requireOrg, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId!;
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    if (!isFeatureEnabled(org?.settings, 'slashCommands')) {
      res.status(404).json({ error: 'Slash commands are not enabled for this org.' });
      return;
    }

    const { input } = req.body as { input?: string };
    const parsed = input ? parseCommandInput(input) : null;
    if (!parsed) {
      res.status(400).json({ error: 'input must be a /command string' });
      return;
    }

    const resolution = await resolveCommandForOrg(orgId, parsed);
    res.json({ data: resolution });
  } catch (err) {
    if (err instanceof CommandResolveError) {
      res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
      return;
    }
    next(err);
  }
});

/**
 * GET /sessions — list current user's active sessions
 */
router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await chatService.listSessions(req.user!.id);
    res.json({ data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/shared — list org-shared sessions visible to the user
 */
router.get('/sessions/shared', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }
    const sessions = await chatService.listSharedSessions(req.user!.id, orgId);
    res.json({ data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/unread-counts — per-session unread count for the current user
 */
router.get('/sessions/unread-counts', requireAuth, async (req, res, next) => {
  try {
    const counts = await chatService.getUnreadCounts(req.user!.id);
    res.json({ data: counts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:id — get session with messages (verify ownership, collab, or org-visible)
 */
router.get('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const session = await chatService.getSession(id, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // Transform attachment storagePath -> url for the API response
    const reactionMap = await chatService.getReactionsForMessages(session.messages.map((m) => m.id));
    const messages = session.messages.map((msg) => ({
      ...msg,
      attachments: (msg.attachments ?? []).map(chatService.toAttachmentResponse),
      reactions: reactionMap[msg.id] ?? [],
    }));
    const messageAuthors = await chatService.getMessageAuthors(messages);
    const lastReadMessageId = await chatService.getSessionRead(id, req.user!.id);
    res.json({ data: { ...session, messages, messageAuthors, lastReadMessageId } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /sessions/:id — rename a session
 */
router.patch('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { title } = req.body as { title?: string };
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const session = await chatService.updateSessionTitle(id, req.user!.id, title.trim());
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /sessions/:id/visibility — toggle org visibility
 */
router.patch('/sessions/:id/visibility', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { visibility } = req.body as { visibility?: SessionVisibility };
    if (!visibility || !['private', 'org'].includes(visibility)) {
      res.status(400).json({ error: 'visibility must be "private" or "org"' });
      return;
    }
    const session = await chatService.setVisibility(id, req.user!.id, visibility);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /sessions/:id — archive a session
 */
router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const session = await chatService.archiveSession(id, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ data: session, message: 'Session archived' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages — send a message and trigger the agent
 * Allows owner or contributor collaborators to send messages.
 */
router.post('/sessions/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const userId = req.user!.id;
    const { content, model, providerId, activeArtifactId, attachmentIds, cognitiveQuery, timezone, agentMode } = req.body as {
      content?: string;
      model?: string;
      providerId?: string;
      activeArtifactId?: string;
      attachmentIds?: string[];
      cognitiveQuery?: { subjectUserId: string };
      timezone?: string;
      agentMode?: string;
    };

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    if (agentMode !== undefined && agentMode !== 'plan' && agentMode !== 'build') {
      res.status(400).json({ error: "agentMode must be 'plan' or 'build'" });
      return;
    }

    // W4: plan mode is gated behind the `planMode` flag. When off, ignore the
    // mode entirely and run today's single build-mode behavior.
    const orgIdForFlag = req.user!.orgId;
    const resolvedMode: 'plan' | 'build' | undefined =
      agentMode && orgIdForFlag && (await isPlanModeEnabled(orgIdForFlag))
        ? (agentMode as 'plan' | 'build')
        : undefined;

    // Check write access (owner or contributor)
    const access = await chatService.getSessionWriteAccess(sessionId, userId);
    if (!access) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Load session for title check
    const session = await chatService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // ── Governance containment ──
    // Blocking policies MUST be evaluated BEFORE the user message is persisted.
    // If we saved the message first and then 403'd, the offending content would
    // remain in the session transcript and be replayed into the LLM context on
    // the next turn — a containment failure (the block would still leak the
    // secret to the model). So for orgs with block enforcement we evaluate the
    // in-memory content up front and, on a block, return 403 WITHOUT ever
    // persisting the message. The violation row + audit + governance:blocked
    // socket event are still written exactly as before (evaluateMessage records
    // every matching policy, including warn/monitor ones, in this single call).
    //
    // `governanceEvaluated` tracks whether this synchronous pass already ran the
    // policy evaluation, so the non-blocking monitor path below doesn't
    // double-evaluate (and double-record) the same message.
    const orgId = req.user!.orgId;
    let governanceEvaluated = false;
    if (orgId) {
      const settings = await getGovernanceSettings(orgId);
      if (settings.enabled && settings.checkUserMessages && (await hasBlockPolicies(orgId))) {
        // Synchronous check — must complete before the message is persisted or
        // sent to the LLM. messageId is null: the message does not (and must
        // not) exist when a block fires.
        const violations = await evaluateMessage({
          orgId, userId, sessionId,
          messageId: undefined as unknown as string, messageRole: 'user', content,
        });
        governanceEvaluated = true;

        const blocked = violations.find(v => v.enforcement === 'block');
        if (blocked) {
          emitToSessionEvent(sessionId, 'governance:blocked', {
            messageId: null,
            policyName: blocked.policyName,
            severity: blocked.severity,
            reason: `This message was blocked by the "${blocked.policyName}" governance policy.`,
          });
          res.status(403).json({
            error: 'Message blocked by governance policy',
            data: { policyName: blocked.policyName, severity: blocked.severity },
          });
          return;
        }
      }
    }

    // Save the user message with attribution (only reached when not blocked).
    // W4: stamp the resolved agent mode on the user message metadata so the
    // transcript records which mode produced the following assistant turn.
    const userMessage = await chatService.addMessage(
      session.orgId,
      sessionId,
      'user',
      content,
      resolvedMode ? { agentMode: resolvedMode } : undefined,
      userId,
    );

    // Link uploaded attachments to this message
    if (attachmentIds && attachmentIds.length > 0) {
      await chatService.linkAttachments(userMessage.id, attachmentIds);
    }

    // Parse @mentions of session participants and notify each mentioned user.
    // Best-effort: never block or fail the send on notification errors.
    void notifyMentions({
      session,
      messageId: userMessage.id,
      authorId: userId,
      authorName: req.user!.name,
      content,
    }).catch((err) => {
      logger.error({ err, sessionId }, 'mention notify failed');
    });

    // Auto-title: if the session has no title, derive one from the first message (owner only)
    if (!session.title && access === 'owner') {
      const title = deriveSessionTitle(content);
      await chatService.updateSessionTitle(sessionId, userId, title);
    }

    // Monitor / observe-only governance for orgs without block policies.
    // (When block policies exist, evaluateMessage already ran above for the
    // persisted-or-not message and recorded all warn/monitor violations too, so
    // we skip re-evaluating here.) Fire-and-forget — never blocks the send.
    if (orgId && !governanceEvaluated) {
      const settings = await getGovernanceSettings(orgId);
      if (settings.enabled && settings.checkUserMessages) {
        evaluateMessage({
          orgId, userId, sessionId,
          messageId: userMessage.id, messageRole: 'user', content,
        }).catch(err => logger.error({ err }, 'Governance evaluation failed'));
      }
    }

    // Respond immediately with 202
    res.status(202).json({ data: { messageId: userMessage.id } });

    // Build agent context and run the agent loop asynchronously.
    // Integration tests set HEARTH_DISABLE_AGENT_DISPATCH to suppress this
    // fire-and-forget loop, which otherwise persists an assistant message after
    // the response and races the next test's DB truncate. The var is only ever
    // set by the integration harness — production/dev behavior is unchanged.
    if (process.env.HEARTH_DISABLE_AGENT_DISPATCH !== 'true') {
      // ── W2 steering: interrupt-and-continue ──
      // If a run is already streaming for this session, sending a new message
      // steers: abort the in-flight run (its partial is persisted + marked
      // interrupted by its own finalize) and start a fresh run below. The new
      // run's history read picks up both the interrupted partial and this new
      // user turn. This is gated behind the `interruptible` flag — when off,
      // the legacy behavior (overlapping runs) is preserved, matching today.
      const steerEnabled = await isInterruptibleEnabled(session.orgId);
      if (steerEnabled) {
        for (const run of getActiveRunsForSession(sessionId)) {
          await requestStop(run.runId);
        }
      }

      const runId = newRunId();
      runAgent({
        orgId: session.orgId,
        sessionId,
        ownerUserId: session.userId,
        model,
        providerId,
        latestMessage: content,
        activeArtifactId,
        cognitiveQuerySubjectId: cognitiveQuery?.subjectUserId,
        timezone,
        respondingToMessageId: userMessage.id,
        runId,
        initiatorUserId: userId,
        agentMode: resolvedMode,
      }).catch((err) => {
        logger.error({ err, sessionId }, 'Agent loop unhandled error');
      });

      // Scan the conversation for an emergent decision ("we've decided to…") and
      // auto-capture it (source: 'chat'). Debounce-to-LAST: each new message
      // removes the pending delayed job and reschedules, so the extraction fires
      // ~8s after the conversation settles and sees the full thread (not the
      // first message). Without this producer the decision-extraction worker's
      // chat path was dead code — chats were never scanned for decisions.
      // Fire-and-forget; never block the message reply. (jobId has no ':' —
      // BullMQ rejects colons in custom ids.)
      void (async () => {
        const jobId = `decision-extract-${sessionId}`;
        await decisionExtractionQueue.remove(jobId).catch(() => {}); // reset debounce window
        await decisionExtractionQueue.add(
          'chat_session',
          { sessionId, userId: session.userId, orgId: session.orgId },
          { jobId, delay: 8000, removeOnComplete: true, removeOnFail: true },
        );
      })().catch((err) => logger.warn({ err, sessionId }, 'Failed to enqueue chat decision extraction'));
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/stop — stop an in-flight agent run (W2).
 *
 * Permission: the run initiator OR a session owner/contributor. A pure viewer
 * gets 403 and the run continues. The abort is broadcast over Redis pub/sub so
 * whichever API instance owns the run aborts it (cross-instance). `runId` is
 * optional in the body; without it, all of the session's runs are stopped.
 */
router.post('/sessions/:id/stop', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const userId = req.user!.id;
    const { runId } = req.body as { runId?: string };

    // 404 vs 403: if the user can't even see the session, treat as not found so
    // we don't leak session existence. Viewers (read access, no write) → 403.
    const session = await chatService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const allowed = await canStopRun(sessionId, userId, runId);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to stop this run' });
      return;
    }

    if (runId) {
      await requestStop(runId);
    } else {
      for (const run of getActiveRunsForSession(sessionId)) {
        await requestStop(run.runId);
      }
    }

    res.status(202).json({ data: { stopped: true, runId: runId ?? null } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/permission — reply to a tool `permission_request` (W3).
 *
 * The chat UI primarily answers over WS (`permission_response`), but this REST
 * route is a transport fallback. The decision resolves the parked ask keyed by
 * `callId`. A response for an already-finished/aborted run (unknown callId) is
 * ignored with 202 (no throw) — exactly the "response after run ended" case.
 * Permission mirrors stop: run initiator or session owner/contributor.
 */
router.post('/sessions/:id/permission', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const userId = req.user!.id;
    const { callId, decision } = req.body as { callId?: string; decision?: string };

    if (!callId || !decision || !['allow_once', 'allow_always', 'deny'].includes(decision)) {
      res.status(400).json({ error: 'callId and a valid decision (allow_once|allow_always|deny) are required' });
      return;
    }

    const session = await chatService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Same gate as stop — initiator or owner/contributor may answer a prompt.
    const allowed = await canStopRun(sessionId, userId);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to respond to this prompt' });
      return;
    }

    const { resolvePermission } = await import('../agent/run-registry.js');
    const resolved = resolvePermission(callId, decision as 'allow_once' | 'allow_always' | 'deny');
    res.status(202).json({ data: { resolved } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages/:messageId/approve-build — "Approve & Build" (W4).
 *
 * Approves the structured plan carried on an assistant message's
 * `metadata.plan` and starts a Build run seeded with the approved steps.
 *
 * Contract:
 *  - 404 — session or plan message not found / not visible to the caller.
 *  - 409 PLAN_NOT_APPROVED — the message carries no (actionable) plan: either
 *    no `metadata.plan`, or an empty/degenerate plan (zero steps). There is
 *    nothing to build.
 *  - 403 — only the plan's OWNER (the user who sent the request that produced
 *    the plan) may approve & build it. A collaborator / non-owner gets 403.
 *  - 200 — idempotent. The approval flips `metadata.plan.approved=true` via a
 *    guarded conditional update; exactly ONE caller wins the flip and starts
 *    the single Build run. A double-approve / double-click returns 200 with
 *    `{ alreadyApproved: true }` and starts NO second run.
 */
router.post('/sessions/:id/messages/:messageId/approve-build', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const userId = req.user!.id;

    const session = await chatService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { approvePlanForBuild } = await import('../services/plan-service.js');
    const result = await approvePlanForBuild({
      sessionId,
      messageId,
      userId,
      sessionOwnerId: session.userId,
    });

    switch (result.status) {
      case 'not_found':
        res.status(404).json({ error: 'Plan message not found' });
        return;
      case 'no_plan':
        res.status(409).json({ error: 'PLAN_NOT_APPROVED', message: 'No actionable plan to build.' });
        return;
      case 'forbidden':
        res.status(403).json({ error: 'Only the plan owner can approve and build this plan.' });
        return;
      case 'already_approved':
        res.status(200).json({ data: { alreadyApproved: true, started: false } });
        return;
      case 'approved':
        break;
    }

    res.status(202).json({ data: { approved: true, started: true } });

    // Start the single Build run seeded with the approved plan (fire-and-forget).
    // Only the flip WINNER reaches here, so exactly one Build run starts.
    if (process.env.HEARTH_DISABLE_AGENT_DISPATCH !== 'true') {
      // Steer: stop any in-flight run for this session first (flag-gated).
      const steerEnabled = await isInterruptibleEnabled(session.orgId);
      if (steerEnabled) {
        for (const run of getActiveRunsForSession(sessionId)) {
          await requestStop(run.runId);
        }
      }

      const buildRunId = newRunId();
      runAgent({
        orgId: result.orgId,
        sessionId,
        ownerUserId: session.userId,
        latestMessage: `Execute the approved plan:\n${result.plan.steps.map((s) => `${s.index}. ${s.text}`).join('\n')}`,
        respondingToMessageId: messageId,
        runId: buildRunId,
        initiatorUserId: userId,
        agentMode: 'build',
        approvedPlan: result.plan,
      }).catch((err) => {
        logger.error({ err, sessionId }, 'Approve-build run unhandled error');
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/read — mark a message as read for the current user
 */
router.post('/sessions/:id/read', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const { lastMessageId } = req.body as { lastMessageId?: string };
    if (!lastMessageId) {
      res.status(400).json({ error: 'lastMessageId is required' });
      return;
    }
    const result = await chatService.markSessionRead(sessionId, req.user!.id, lastMessageId);
    if (!result) {
      res.status(404).json({ error: 'Session or message not found' });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages/:messageId/reactions — add a reaction
 */
router.post('/sessions/:id/messages/:messageId/reactions', requireAuth, async (req, res, next) => {
  try {
    const { emoji } = req.body as { emoji?: string };
    if (!emoji || !chatService.isAllowedReactionEmoji(emoji)) {
      res.status(400).json({ error: 'emoji must be one of the allowed reactions' });
      return;
    }
    const sessionId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const result = await chatService.addMessageReaction(sessionId, messageId, req.user!.id, emoji);
    if (!result) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    emitToSessionEvent(sessionId, 'message:reaction', {
      messageId,
      userId: req.user!.id,
      emoji,
      op: 'add',
    });

    // Notify the message author that someone reacted (skip self-reactions).
    // Best-effort: never block or fail the request on notification errors.
    void notifyReactionOnMessage({
      sessionId,
      messageId,
      reactorId: req.user!.id,
      reactorName: req.user!.name,
      emoji,
    }).catch((err) => {
      logger.error({ err, sessionId, messageId }, 'reaction_on_your_message notify failed');
    });

    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /sessions/:id/messages/:messageId/reactions/:emoji — remove a reaction
 */
router.delete('/sessions/:id/messages/:messageId/reactions/:emoji', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const emoji = decodeURIComponent(req.params.emoji as string);
    const result = await chatService.removeMessageReaction(sessionId, messageId, req.user!.id, emoji);
    if (result === null) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (result) {
      emitToSessionEvent(sessionId, 'message:reaction', {
        messageId,
        userId: req.user!.id,
        emoji,
        op: 'remove',
      });
    }
    res.json({ data: { messageId, emoji, removed: result } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages/:messageId/feedback — rate a message
 */
router.post('/sessions/:id/messages/:messageId/feedback', requireAuth, async (req, res, next) => {
  try {
    const { rating } = req.body as { rating?: 'positive' | 'negative' };
    if (!rating || !['positive', 'negative'].includes(rating)) {
      res.status(400).json({ error: 'rating must be "positive" or "negative"' });
      return;
    }
    const messageId = req.params.messageId as string;
    const { prisma } = await import('../lib/prisma.js');
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, session: { id: req.params.id as string } },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const metadata = (message.metadata as Record<string, unknown>) ?? {};
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, feedback: rating } as never },
    });
    res.json({ data: { messageId, rating } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/join — join an org-visible session as a contributor
 */
router.post('/sessions/:id/join', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const result = await chatService.joinSession(sessionId, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'Session not found or not accessible' });
      return;
    }
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:id/collaborators — list collaborators
 */
router.get('/sessions/:id/collaborators', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    // Require session access — the collaborator list exposes names/emails and
    // must not be readable by any authenticated user who guesses a session id.
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const collaborators = await chatService.listCollaborators(sessionId);
    res.json({ data: collaborators });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/collaborators — add a collaborator
 */
router.post('/sessions/:id/collaborators', requireAuth, async (req, res, next) => {
  try {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const validRole = role === 'contributor' ? 'contributor' : 'viewer';
    const sessionId = req.params.id as string;
    const result = await chatService.addCollaborator(
      sessionId,
      req.user!.id,
      userId,
      validRole,
    );
    if (!result) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Notify the added user via WebSocket (legacy ephemeral event for any
    // existing client listeners) and persist via the notification spine.
    const session = await chatService.getSession(sessionId, req.user!.id);
    emitToUser(userId, 'collaborator:added', {
      sessionId,
      sessionTitle: session?.title ?? null,
      addedByName: req.user!.name ?? 'Someone',
      role: validRole,
    });
    if (session) {
      void notify({
        orgId: session.orgId,
        userId,
        type: 'collaborator_added',
        title: `${req.user!.name ?? 'Someone'} added you to a chat`,
        body: session.title ?? 'Untitled chat',
        sessionId,
        entityType: 'chat_session',
        entityId: sessionId,
      });
    }

    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /sessions/:id/collaborators/:userId — remove a collaborator
 */
router.delete('/sessions/:id/collaborators/:userId', requireAuth, async (req, res, next) => {
  try {
    const result = await chatService.removeCollaborator(
      req.params.id as string,
      req.user!.id,
      req.params.userId as string,
    );
    if (!result) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ message: 'Collaborator removed' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:sessionId/messages/:messageId/promote-to-task
 * — explicit user-initiated chat→task creation. Idempotent on (messageId, user).
 */
router.post('/sessions/:sessionId/messages/:messageId/promote-to-task', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId as string;
    const messageId = req.params.messageId as string;
    const {
      title,
      description,
      attachMessageIds,
      attachRecentN,
      targetStatus,
      priority,
      provenance,
    } = req.body as {
      title?: string;
      description?: string;
      attachMessageIds?: string[];
      attachRecentN?: number;
      targetStatus?: 'backlog' | 'planning';
      priority?: number;
      provenance?: 'chat_button' | 'chat_slash' | 'agent_create' | 'agent_propose_accepted';
    };

    // Permission: caller must have read access to the session.
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Validate the message belongs to this session.
    const { prisma } = await import('../lib/prisma.js');
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, sessionId },
      select: { id: true, content: true },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found in session' });
      return;
    }

    // Synthesise title/description if omitted (best-effort; falls back to content).
    let finalTitle = title?.trim();
    let finalDescription = description?.trim();
    if (!finalTitle) {
      finalTitle = message.content.slice(0, 80).replace(/\s+/g, ' ').trim() || 'New task';
    }
    if (!finalDescription) {
      finalDescription = message.content.length > 80 ? message.content : undefined;
    }

    const result = await chatService.promoteMessageToTask({
      sessionId,
      messageId,
      userId: req.user!.id,
      title: finalTitle,
      description: finalDescription,
      attachMessageIds,
      attachRecentN: attachRecentN ?? 4,
      targetStatus: targetStatus === 'planning' ? 'planning' : 'backlog',
      priority,
      provenance: provenance ?? 'chat_button',
    });

    // If targetStatus = 'planning', enqueue the planner so it auto-progresses.
    if (!result.existing && targetStatus === 'planning') {
      const { enqueuePlanning } = await import('../services/task-planner.js');
      enqueuePlanning(result.task.id, req.user!.id).catch((err) => {
        logger.error({ err, taskId: result.task.id }, 'Failed to enqueue planning for promoted task');
      });
    }

    // Notify the creator's chat UI (so the chip can render under the message).
    emitToUser(req.user!.id, 'task:created_from_chat', {
      taskId: result.task.id,
      title: result.task.title,
      status: result.task.status,
      sessionId,
      originatingMessageId: messageId,
      messageCount: result.messageCount,
      existing: result.existing,
    });

    res.status(result.existing ? 200 : 201).json({
      data: {
        ...result.task,
        existing: result.existing,
        messageCount: result.messageCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:sessionId/active-tasks
 * — count of in-flight tasks (planning + executing) promoted from this session.
 */
router.get('/sessions/:sessionId/active-tasks', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const summary = await chatService.countActiveTasksFromSession(sessionId, req.user!.id);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:sessionId/messages/:messageId/tasks/:taskId/unlink
 * — undo a chat→task promotion: archives the task and de-links it from
 * the message. Caller must own the task.
 */
router.post('/sessions/:sessionId/messages/:messageId/tasks/:taskId/unlink', requireAuth, async (req, res, next) => {
  try {
    const ok = await chatService.unlinkPromotedTask({
      sessionId: req.params.sessionId as string,
      messageId: req.params.messageId as string,
      taskId: req.params.taskId as string,
      userId: req.user!.id,
    });
    if (!ok) {
      res.status(404).json({ error: 'Task not found or not owned by you' });
      return;
    }
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users/search — search org members for collaborator autocomplete
 */
router.get('/users/search', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }
    // Empty/short query is allowed — typing just "@" should surface teammates
    // immediately (searchOrgMembers caps the result set).
    const q = (req.query.q as string) || '';
    const users = await chatService.searchOrgMembers(orgId, q, req.user!.id);
    res.json({ data: users });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations/active — list connected integration IDs
 */
router.get('/integrations/active', requireAuth, async (_req, res, next) => {
  try {
    const { mcpGateway } = await import('../mcp/gateway.js');
    const integrations = mcpGateway.getConnectedIntegrations();
    res.json({ data: integrations });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /cognitive-profile/status — get user's cognitive profile opt-in status
 */
router.get('/cognitive-profile/status', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: { orgEnabled: false, userEnabled: false } });
      return;
    }
    const orgEnabled = await isCognitiveEnabledForOrg(orgId);
    const userEnabled = orgEnabled ? await getCognitiveEnabled(req.user!.id, orgId) : false;
    res.json({ data: { orgEnabled, userEnabled } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /cognitive-profile/status — toggle user's cognitive profile opt-in/out
 */
router.put('/cognitive-profile/status', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'No organization context' });
      return;
    }
    const orgEnabled = await isCognitiveEnabledForOrg(orgId);
    if (!orgEnabled) {
      res.status(400).json({ error: 'Cognitive profiles are not enabled for this organization' });
      return;
    }
    const { enabled } = req.body as { enabled?: boolean };
    await setCognitiveEnabled(req.user!.id, orgId, !!enabled);
    res.json({ message: 'Cognitive profile status updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * Notifies the author of a chat message that someone reacted to it.
 * No-op when the reactor is the author, or when the message has no human
 * author (e.g. assistant/system messages have a null createdBy).
 * Best-effort — caller wraps in `void ... .catch()`.
 */
async function notifyReactionOnMessage(input: {
  sessionId: string;
  messageId: string;
  reactorId: string;
  reactorName?: string;
  emoji: string;
}): Promise<void> {
  const { prisma } = await import('../lib/prisma.js');
  const message = await prisma.chatMessage.findFirst({
    where: { id: input.messageId, sessionId: input.sessionId },
    select: { id: true, orgId: true, createdBy: true },
  });
  if (!message || !message.createdBy) return;
  if (message.createdBy === input.reactorId) return;

  const session = await prisma.chatSession.findUnique({
    where: { id: input.sessionId },
    select: { title: true },
  });

  await notify({
    orgId: message.orgId,
    userId: message.createdBy,
    type: 'reaction_on_your_message',
    title: `${input.reactorName ?? 'Someone'} reacted ${input.emoji} to your message`,
    body: session?.title ?? 'Untitled chat',
    sessionId: input.sessionId,
    entityType: 'chat_message',
    entityId: input.messageId,
  });
}

/**
 * Parses @mentions out of a chat message and notifies each mentioned session
 * participant (owner or collaborator). Self-mentions are skipped. Names are
 * resolved against the session's participants only, so mentions never leak to
 * non-participants. Best-effort — caller wraps in `void ... .catch()`.
 */
async function notifyMentions(input: {
  session: { id: string; orgId: string; userId: string; title: string | null; collaborators: Array<{ userId: string }> };
  messageId: string;
  authorId: string;
  authorName?: string;
  content: string;
}): Promise<void> {
  // Extract @mention tokens. Supports "@Name" and "@First Last" (up to two words).
  const rawMentions = input.content.match(/@([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)?)/gu);
  if (!rawMentions || rawMentions.length === 0) return;

  // Build the set of participant userIds (owner + collaborators), minus the author.
  const participantIds = new Set<string>([input.session.userId, ...input.session.collaborators.map((c) => c.userId)]);
  participantIds.delete(input.authorId);
  if (participantIds.size === 0) return;

  const { prisma } = await import('../lib/prisma.js');
  const participants = await prisma.user.findMany({
    where: { id: { in: Array.from(participantIds) } },
    select: { id: true, name: true },
  });
  if (participants.length === 0) return;

  // Normalise candidate mention strings (strip leading @, collapse whitespace,
  // lowercase). Each "@First Last" capture also yields its first word as a
  // candidate, so "@Jordan can you..." still matches "Jordan" even though the
  // regex greedily grabbed the following word.
  const mentionCandidates = new Set<string>();
  for (const raw of rawMentions) {
    const norm = raw.replace(/^@/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!norm) continue;
    mentionCandidates.add(norm);
    const firstWord = norm.split(' ')[0];
    if (firstWord) mentionCandidates.add(firstWord);
  }

  // Match each participant whose full name or first name appears as a mention.
  const matched = new Map<string, { id: string; name: string }>();
  for (const p of participants) {
    const full = p.name.replace(/\s+/g, ' ').trim().toLowerCase();
    const first = full.split(' ')[0] ?? '';
    if (mentionCandidates.has(full) || (first && mentionCandidates.has(first))) {
      matched.set(p.id, p);
    }
  }
  if (matched.size === 0) return;

  await Promise.all(
    Array.from(matched.values()).map((p) =>
      notify({
        orgId: input.session.orgId,
        userId: p.id,
        type: 'mention',
        title: `${input.authorName ?? 'Someone'} mentioned you`,
        body: input.session.title ?? 'Untitled chat',
        sessionId: input.session.id,
        entityType: 'chat_message',
        entityId: input.messageId,
      }),
    ),
  );
}

/**
 * Whether the org has the W2 `interruptible` feature flag on. Gates steering
 * (interrupt-and-continue). When off, overlapping runs behave as they did
 * before W2. Best-effort: defaults to false on any lookup failure.
 */
async function isInterruptibleEnabled(orgId: string): Promise<boolean> {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    return isFeatureEnabled(org?.settings, 'interruptible');
  } catch {
    return false;
  }
}

/**
 * Whether the org has the W3 `permissions` feature flag on. Gates the
 * interactive per-tool permission gate in the agent loop. When off, tools run
 * unconditionally (today's behavior). Best-effort: defaults false on failure.
 */
async function isPermissionsEnabled(orgId: string): Promise<boolean> {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    return isFeatureEnabled(org?.settings, 'permissions');
  } catch {
    return false;
  }
}

/**
 * Whether the org has the W4 `planMode` feature flag on. Gates plan/build mode
 * end-to-end: when off, `agentMode` on the message body is ignored and runs use
 * today's single build-mode behavior. Best-effort: defaults false on failure.
 */
async function isPlanModeEnabled(orgId: string): Promise<boolean> {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    return isFeatureEnabled(org?.settings, 'planMode');
  } catch {
    return false;
  }
}

/**
 * Derives a short session title from the first user message.
 * Truncates to 60 chars at a word boundary.
 */
function deriveSessionTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Runs the agent loop for a session, emitting events via WebSocket
 * and saving the final assistant message. On error, persists an
 * assistant message describing the failure and emits an error event.
 */
interface RunAgentOpts {
  orgId: string;
  sessionId: string;
  ownerUserId: string;
  model?: string;
  providerId?: string;
  latestMessage?: string;
  activeArtifactId?: string;
  cognitiveQuerySubjectId?: string;
  timezone?: string;
  respondingToMessageId?: string;
  runId?: string;
  initiatorUserId?: string;
  /** W4: plan/build mode for this run. */
  agentMode?: 'plan' | 'build';
  /** W4: an approved plan to seed a build run with. */
  approvedPlan?: import('../agent/types.js').AgentPlan;
}

async function runAgent(opts: RunAgentOpts): Promise<void> {
  const {
    orgId,
    sessionId,
    ownerUserId,
    model,
    providerId,
    latestMessage,
    activeArtifactId,
    cognitiveQuerySubjectId,
    timezone,
    respondingToMessageId,
    runId,
    initiatorUserId,
    agentMode,
    approvedPlan,
  } = opts;
  // W4: captured structured plan from a plan-mode run's `submit_plan` tool.
  let capturedPlan: import('../agent/types.js').AgentPlan | null = null;
  let assistantContent = '';
  let errorMessage: string | null = null;
  let sawErrorEvent = false;
  // W2: the stop reason the loop finished with. Drives whether the persisted
  // assistant message is marked interrupted, and whether finalize was claimed.
  let stopReason: import('@hearth/shared').StopReason | undefined;
  // Whether THIS invocation won the single finalize claim for its runId. When
  // false (lost the stop↔done race), we must not persist a second assistant
  // message or emit a second `done`.
  let didFinalize = false;
  const startTime = Date.now();
  let iterationCount = 0;
  let totalTokens = 0;
  const toolFailures: string[] = [];
  let contextSources: Array<{ index: number; type: string; label: string; content: string }> = [];

  // W2: register this run so it can be stopped (locally or cross-instance). The
  // AbortController's signal is threaded into the agent loop → provider + tools.
  const effectiveRunId = runId ?? newRunId();
  const controller = registerRun({
    runId: effectiveRunId,
    sessionId,
    initiatorUserId: initiatorUserId ?? ownerUserId,
  });
  // Tell subscribed clients the runId for this turn so they can target a stop.
  emitToSessionEvent(sessionId, 'chat:run_started', { sessionId, runId: effectiveRunId });

  try {
    const context = await buildAgentContext(ownerUserId, sessionId, latestMessage, activeArtifactId, {
      cognitiveQuerySubjectId,
      timezone,
      agentMode,
      approvedPlan,
      onPlanSubmitted: (plan) => { capturedPlan = plan; },
    });
    if (model) context.model = model;
    if (providerId) context.providerId = providerId;
    context.runId = effectiveRunId;
    context.abortSignal = controller.signal;
    // W3: gate the per-tool permission policy behind the `permissions` flag.
    // Off = today's behavior (no gating). Best-effort lookup — defaults false.
    context.permissionsEnabled = await isPermissionsEnabled(orgId);
    contextSources = context.sources ?? [];

    // Emit memory debug info for dev/debug tools
    if (contextSources.length > 0) {
      emitToSessionEvent(sessionId, 'memory:debug', {
        sources: contextSources,
        rollingSummary: null,
        timestamp: new Date().toISOString(),
      });
    }

    // Load conversation history — skip tool-role messages (providers reject
    // them without matching tool_use_id linkage from the original call).
    const dbMessages = await chatService.getMessages(sessionId);

    // Shared sessions interleave messages from several people, but the model
    // only receives { role, content } — so without attribution it sees one
    // anonymous "user" voice and can't tell collaborators apart. When more than
    // one human has posted, prefix each user message with the author's name and
    // tell the agent to track who said what.
    const humanAuthorIds = new Set(
      dbMessages.filter((m) => m.role === 'user' && m.createdBy).map((m) => m.createdBy as string),
    );
    const isCollaborative = humanAuthorIds.size > 1;
    const authors = isCollaborative ? await chatService.getMessageAuthors(dbMessages) : {};
    const speaker = (m: (typeof dbMessages)[number]): string =>
      isCollaborative && m.role === 'user' && m.createdBy && authors[m.createdBy]
        ? `${authors[m.createdBy].name}: `
        : '';
    if (isCollaborative) {
      context.systemPrompt =
        (context.systemPrompt ?? '') +
        '\n\nThis is a shared, multi-person session. Each user message below is prefixed with the speaker\'s name (e.g. "Priya: ..."). Track who said what, address people by name, and call out where participants agree or disagree.';
    }

    const messages: LLMMessage[] = dbMessages
      .filter((m) => {
        if (m.role === 'tool') return false;
        // Skip task-progress system messages — they're UI-only.
        if (m.role === 'system') {
          const meta = (m.metadata as Record<string, unknown> | null) ?? {};
          if (meta.kind === 'task_progress') return false;
        }
        return true;
      })
      .map((m) => {
        // Check for image attachments on this message
        const imageAttachments = (m.attachments ?? []).filter(
          (a) => a.mimeType.startsWith('image/'),
        );

        if (imageAttachments.length > 0 && m.role === 'user' && context.visionEnabled !== false) {
          // Build multimodal content with images + text
          const parts: ContentPart[] = [];

          for (const att of imageAttachments) {
            try {
              const filePath = join(process.cwd(), att.storagePath);
              const buffer = readFileSync(filePath);
              parts.push({
                type: 'image',
                mimeType: att.mimeType,
                data: buffer.toString('base64'),
              });
            } catch {
              // Skip unreadable attachments
            }
          }

          if (m.content) {
            parts.push({ type: 'text', text: speaker(m) + m.content });
          }

          return {
            role: m.role as LLMMessage['role'],
            content: parts.length > 0 ? parts : m.content,
          };
        }

        return {
          role: m.role as LLMMessage['role'],
          content: m.role === 'user' ? speaker(m) + m.content : m.content,
        };
      });

    // Rolling summary: if conversation is long, summarize older messages
    const rawForSummary = dbMessages
      .filter((m) => {
        if (m.role === 'tool') return false;
        // Skip task-progress system messages — they're UI-only.
        if (m.role === 'system') {
          const meta = (m.metadata as Record<string, unknown> | null) ?? {};
          if (meta.kind === 'task_progress') return false;
        }
        return true;
      })
      .map((m) => ({ role: m.role, content: m.content }));
    const rollingSummary = await chatService.summarizeEarlierMessages(rawForSummary);

    let finalMessages = messages;
    if (rollingSummary) {
      // Keep only the last 10 messages, prepend summary as a system message
      const keepRecent = 10;
      finalMessages = messages.slice(Math.max(0, messages.length - keepRecent));
      // Inject summary into the agent context for system prompt
      context.rollingSummary = rollingSummary;
    }

    for await (const event of agentLoop(context, finalMessages)) {
      // W2 idempotent finalize: the loop yields exactly one terminal `done`.
      // Claim finalization on it so a stop↔natural-done race (or a double
      // emission from any path) persists/broadcasts exactly one `done`. If the
      // claim fails, another finalize already won — drop this terminal event.
      if (event.type === 'done') {
        if (!claimFinalize(effectiveRunId)) {
          // Another finalize already won (stop↔done race / double drive).
          // Don't broadcast or persist a second terminal — bail out; the
          // `finally` persistence is gated on `didFinalize` below.
          return;
        }
        didFinalize = true;
        stopReason = event.stopReason;
        totalTokens += (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0);
        iterationCount++;
        emitToSession(sessionId, event);
        continue;
      }

      emitToSession(sessionId, event);

      if (event.type === 'text_delta') {
        assistantContent += event.content;
      } else if (event.type === 'error') {
        sawErrorEvent = true;
        errorMessage = event.message;
      } else if (event.type === 'tool_progress' && event.status === 'failed') {
        toolFailures.push(event.toolName);
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Agent execution failed';
    logger.error({ err, sessionId }, 'Agent loop threw');
    // Claim finalize for the exception path too, so an error + a racing stop
    // don't both persist. If another finalize already won, suppress ours.
    if (claimFinalize(effectiveRunId)) {
      didFinalize = true;
      emitToSession(sessionId, {
        type: 'error',
        message: 'Agent encountered an unexpected error',
      });
    } else {
      errorMessage = null;
    }
  } finally {
    unregisterRun(effectiveRunId);
    // Persist only if THIS invocation won the finalize claim. A lost race means
    // another finalize already persisted exactly one assistant message.
    // Always persist whatever was produced. If there was an error, append
    // a note so the user sees context on page refresh.
    try {
      const interrupted = stopReason === 'interrupted';
      // Persist when we won finalize AND there's something to persist — content,
      // an error, or an interruption (an interrupted run always persists a row,
      // even an empty partial, so the transcript records the stopped turn).
      if (didFinalize && (assistantContent || errorMessage || interrupted)) {
        const finalContent = errorMessage
          ? assistantContent
            ? `${assistantContent}\n\n_[Error: ${errorMessage}]_`
            : `_[Error: ${errorMessage}]_`
          : assistantContent;

        const assistantMsg = await chatService.addMessage(
          orgId,
          sessionId,
          'assistant',
          finalContent,
          {
            error: errorMessage ?? undefined,
            errorSource: sawErrorEvent ? 'llm' : errorMessage ? 'runtime' : undefined,
            sources: contextSources.length > 0 ? contextSources : undefined,
            // W2: mark interrupted partials so the UI renders a "stopped"
            // affordance and history stays coherent.
            interrupted: interrupted ? true : undefined,
            stopReason: stopReason && stopReason !== 'done' ? stopReason : undefined,
            // W4: stamp the agent mode + structured plan (plan mode) on the
            // assistant message. `plan.approved=false` here; "Approve & Build"
            // flips it. The plan object is what the approve endpoint reads.
            agentMode: agentMode ?? undefined,
            plan: capturedPlan
              ? { ...(capturedPlan as import('../agent/types.js').AgentPlan), approved: false }
              : undefined,
          },
          undefined,
          respondingToMessageId,
        );

        // Link any artifacts the agent created during this turn to the message
        // that produced them, so the chat renders an inline card to open them
        // (and the link survives reload). create_artifact runs mid-loop, before
        // this message exists, so it can't set parentMessageId itself.
        if (assistantMsg) {
          try {
            const { prisma } = await import('../lib/prisma.js');
            await prisma.artifact.updateMany({
              where: { sessionId, parentMessageId: null, createdAt: { gte: new Date(startTime) } },
              data: { parentMessageId: assistantMsg.id },
            });
          } catch (linkErr) {
            logger.warn({ err: linkErr, sessionId }, 'Failed to link artifacts to assistant message');
          }
        }
      }
    } catch (persistErr) {
      logger.error({ err: persistErr, sessionId }, 'Failed to persist assistant message');
    }

    // Phase 2: Governance check on AI response
    if (assistantContent && !errorMessage) {
      try {
        const session = await chatService.getSession(sessionId, ownerUserId);
        if (session) {
          // Look up user's org
          const { prisma } = await import('../lib/prisma.js');
          const owner = await prisma.user.findUnique({
            where: { id: ownerUserId },
            include: { team: { select: { orgId: true } } },
          });
          const orgId = owner?.team?.orgId;
          if (orgId) {
            evaluateMessage({
              orgId, userId: ownerUserId, sessionId,
              messageId: `assistant_${Date.now()}`, messageRole: 'assistant',
              content: assistantContent,
            }).catch(err => logger.error({ err }, 'Governance check on AI response failed'));
          }
        }
      } catch (govErr) {
        logger.error({ err: govErr }, 'Governance AI response check setup failed');
      }
    }

    // Post-session reflection — fire-and-forget
    const durationMs = Date.now() - startTime;
    const user = await (async () => {
      try {
        const { prisma } = await import('../lib/prisma.js');
        const u = await prisma.user.findUnique({
          where: { id: ownerUserId },
          include: { team: { select: { orgId: true } } },
        });
        return u;
      } catch { return null; }
    })();
    const orgIdForReflection = user?.team?.orgId;
    if (orgIdForReflection) {
      reflectOnSession({
        sessionId,
        userId: ownerUserId,
        orgId: orgIdForReflection,
        durationMs,
        iterationCount,
        tokenCount: totalTokens || undefined,
        toolFailures: toolFailures.length > 0 ? toolFailures : undefined,
      }).catch(err => logger.error({ err, sessionId }, 'Post-session reflection failed'));

      // Cognitive pattern extraction — gated behind org setting
      isCognitiveEnabledForOrg(orgIdForReflection).then(enabled => {
        if (enabled) {
          enqueueCognitiveExtraction({
            sessionId,
            userId: ownerUserId,
            orgId: orgIdForReflection,
          }).catch(err => logger.error({ err, sessionId }, 'Cognitive extraction enqueue failed'));
        }
      }).catch(err => logger.error({ err }, 'Cognitive org check failed'));
    }
  }
}

export default router;
