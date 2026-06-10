/**
 * Concurrency race tests (Part 1 Tier E; Part 2 §2.11 KANBAN-Z-01,
 * §2.5 CHAT-X-06, §2.7 ARTIFACT-E-05).
 *
 * Exercises correctness-under-concurrency with multiple browser contexts
 * firing parallel API requests at the same resource. Assertions are about
 * consistency and absence of server errors — NOT about exact ordering,
 * which is intentionally unspecified today.
 *
 * Standalone run (root playwright.config.ts projects don't match this dir):
 *   pnpm exec playwright test -c e2e/concurrency
 * (passing a directory as --config makes Playwright use a default config
 * with that directory as testDir).
 *
 * Prerequisites: API running on http://localhost:8000 and the e2e users
 * seeded — run the main suite's setup project once first:
 *   pnpm exec playwright test --project=setup
 */
import { test, expect } from '@playwright/test';
import {
  USERS,
  loginAsNewContext,
  apiGet,
  apiPost,
  apiPatch,
  createTask,
  deleteTask,
  createSession,
  deleteSession,
  sendMessage,
  uniqueId,
} from '../fixtures/test-helpers';

test.describe('Concurrency races', () => {
  // ── (a) Kanban: two tabs move the same card to different statuses ─────────
  test('KANBAN-Z-01: parallel status PATCHes on one task stay consistent (no crash)', async ({
    browser,
  }) => {
    // Same user in two isolated contexts = "two tabs" on the same board.
    // (Tasks are owner-private, so the race must come from one user.)
    const tabA = await loginAsNewContext(browser, 'dev1');
    const tabB = await loginAsNewContext(browser, 'dev1');
    let taskId: string | null = null;

    try {
      const task = await createTask(tabA.page, tabA.csrf, {
        title: uniqueId('race-kanban'),
      });
      taskId = task.id;

      // Tasks are created as auto_detected; settle into backlog so both race
      // targets (planning, archived) are valid transitions from the same state.
      const settle = await apiPatch(tabA.page, tabA.csrf, `/tasks/${task.id}`, {
        status: 'backlog',
      });
      expect(settle.status).toBe(200);

      const [resA, resB] = await Promise.all([
        apiPatch(tabA.page, tabA.csrf, `/tasks/${task.id}`, { status: 'planning' }),
        apiPatch(tabB.page, tabB.csrf, `/tasks/${task.id}`, { status: 'archived' }),
      ]);

      // No 5xx: each write either succeeds (200) or is rejected as an invalid
      // transition (422) when serialized after the other write landed.
      for (const res of [resA, resB]) {
        expect([200, 422]).toContain(res.status);
      }
      expect([resA.status, resB.status]).toContain(200);

      // Final state is exactly one of the two requested targets — consistent,
      // not corrupted, not stuck in backlog.
      const final = await apiGet(tabA.page, `/tasks/${task.id}`);
      expect(final.status).toBe(200);
      expect(['planning', 'archived']).toContain(final.body.data.status);

      // DEFECT (KANBAN-Z-01): no optimistic lock — updateTask has no
      // updatedAt/version precondition, so when both PATCHes read 'backlog'
      // concurrently BOTH return 200 and the loser is silently overwritten
      // (last-write-wins lost update). We record the observation; fixing it
      // should make the second writer fail with a 409/412.
      if (resA.status === 200 && resB.status === 200) {
        test.info().annotations.push({
          type: 'defect-observed',
          description:
            'KANBAN-Z-01: both concurrent status PATCHes returned 200 — silent lost update (no optimistic lock)',
        });
      }
    } finally {
      if (taskId) await deleteTask(tabA.page, tabA.csrf, taskId).catch(() => {});
      await tabA.cleanup();
      await tabB.cleanup();
    }
  });

  // ── (b) Chat: two users send to one session at the same instant ───────────
  test('CHAT-X-06: parallel messages from two users both accepted, none 5xx', async ({
    browser,
  }) => {
    const owner = await loginAsNewContext(browser, 'dev1');
    const other = await loginAsNewContext(browser, 'dev2');
    let sessionId: string | null = null;

    try {
      const session = await createSession(owner.page, owner.csrf, uniqueId('race-chat'));
      sessionId = session.id;

      // Make the session org-visible and have the second user join — joiners
      // become contributors and may send messages.
      const vis = await apiPatch(
        owner.page,
        owner.csrf,
        `/chat/sessions/${session.id}/visibility`,
        { visibility: 'org' },
      );
      expect(vis.status).toBe(200);
      const join = await apiPost(other.page, other.csrf, `/chat/sessions/${session.id}/join`);
      expect(join.status).toBe(201);

      const contentA = `race message from ${USERS.dev1.name} ${uniqueId('a')}`;
      const contentB = `race message from ${USERS.dev2.name} ${uniqueId('b')}`;
      const [msgA, msgB] = await Promise.all([
        sendMessage(owner.page, owner.csrf, session.id, contentA),
        sendMessage(other.page, other.csrf, session.id, contentB),
      ]);

      // Both intakes accepted asynchronously — 202 with distinct message ids,
      // and crucially no 500 from the concurrent path.
      expect(msgA.status).toBe(202);
      expect(msgB.status).toBe(202);
      expect(msgA.body.data.messageId).toBeTruthy();
      expect(msgB.body.data.messageId).toBeTruthy();
      expect(msgA.body.data.messageId).not.toBe(msgB.body.data.messageId);

      // Both user messages persisted in the session — neither write was lost.
      const detail = await apiGet(owner.page, `/chat/sessions/${session.id}`);
      expect(detail.status).toBe(200);
      const userMessages = (detail.body.data.messages as Array<{ role: string; content: string }>)
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      expect(userMessages).toContain(contentA);
      expect(userMessages).toContain(contentB);

      // Known finding (CHAT-X-06): there is no single-flight lock on agent
      // runs, so the two 202s spawn two parallel agent loops with unmanaged
      // interleaving. This test pins intake correctness only (both persisted,
      // no error); agent-output ordering is deliberately not asserted.
    } finally {
      if (sessionId) await deleteSession(owner.page, owner.csrf, sessionId).catch(() => {});
      await owner.cleanup();
      await other.cleanup();
    }
  });

  // ── (c) Artifacts: two tabs save a new version simultaneously ─────────────
  test('ARTIFACT-E-05: parallel artifact PATCHes leave a readable, consistent artifact', async ({
    browser,
  }) => {
    const tabA = await loginAsNewContext(browser, 'dev1');
    const tabB = await loginAsNewContext(browser, 'dev1');
    let sessionId: string | null = null;

    try {
      const session = await createSession(tabA.page, tabA.csrf, uniqueId('race-artifact'));
      sessionId = session.id;

      const created = await apiPost(
        tabA.page,
        tabA.csrf,
        `/chat/sessions/${session.id}/artifacts`,
        {
          type: 'code',
          title: uniqueId('race-artifact'),
          content: 'export const version = 1;',
          language: 'typescript',
        },
      );
      expect(created.status).toBe(201);
      const artifactId = created.body.data.id as string;

      const contentA = `export const editedBy = 'tab-a'; // ${uniqueId('a')}`;
      const contentB = `export const editedBy = 'tab-b'; // ${uniqueId('b')}`;
      const [resA, resB] = await Promise.all([
        apiPatch(tabA.page, tabA.csrf, `/chat/artifacts/${artifactId}`, { content: contentA }),
        apiPatch(tabB.page, tabB.csrf, `/chat/artifacts/${artifactId}`, { content: contentB }),
      ]);

      // No server crash on the concurrent version bump, and at least one
      // write must land.
      expect(resA.status).toBeLessThan(500);
      expect(resB.status).toBeLessThan(500);
      expect([resA.status, resB.status]).toContain(200);

      // The artifact stays readable and its content is exactly one of the two
      // submitted bodies (no torn/merged write).
      const final = await apiGet(tabA.page, `/chat/artifacts/${artifactId}`);
      expect(final.status).toBe(200);
      expect([contentA, contentB]).toContain(final.body.data.content);
      expect(final.body.data.version).toBeGreaterThanOrEqual(2);

      // Version history remains queryable after the race.
      const versions = await apiGet(tabA.page, `/chat/artifacts/${artifactId}/versions`);
      expect(versions.status).toBe(200);
      const versionNumbers = (versions.body.data as Array<{ version: number }>).map(
        (v) => v.version,
      );
      expect(versionNumbers.length).toBeGreaterThanOrEqual(1);

      // DEFECT (ARTIFACT-E-05): no optimistic lock — both PATCHes read the
      // same base version, so both can bump to the same version number and
      // one edit is silently lost (ArtifactVersion has no unique constraint
      // on (artifactId, version), so duplicate snapshots can appear).
      if (new Set(versionNumbers).size !== versionNumbers.length) {
        test.info().annotations.push({
          type: 'defect-observed',
          description: `ARTIFACT-E-05: duplicate version numbers in history (${versionNumbers.join(', ')}) — concurrent edits collided on the same base version`,
        });
      }
      if (resA.status === 200 && resB.status === 200) {
        test.info().annotations.push({
          type: 'defect-observed',
          description:
            'ARTIFACT-E-05: both concurrent artifact PATCHes returned 200 — lost update (no version precondition)',
        });
      }
    } finally {
      if (sessionId) await deleteSession(tabA.page, tabA.csrf, sessionId).catch(() => {});
      await tabA.cleanup();
      await tabB.cleanup();
    }
  });
});
