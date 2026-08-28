import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../mcp/token-store.js';
import { mcpGateway } from '../mcp/gateway.js';
import type { ConnectorConfig } from '../mcp/connectors/base-connector.js';
import { logger } from '../lib/logger.js';
import { enqueueConnectBackfill } from '../jobs/work-intake-scheduler.js';
import { markStepComplete } from './onboarding-service.js';

interface ConnectParams {
  provider: string;
  credentials: Record<string, string>;
  serverUrl?: string;
  label?: string;
  /**
   * The user performing the connect. Their personal memory layer receives the
   * backfilled content and their tasks surface from the on-connect detection.
   */
  userId?: string;
}

const INTEGRATION_SUMMARY_SELECT = {
  id: true,
  userId: true,
  provider: true,
  status: true,
  enabled: true,
  healthCheckedAt: true,
  createdAt: true,
  updatedAt: true,
  // Omit config — contains encrypted credentials
} as const;

/**
 * List all integrations for an organization (admin/org-level view — includes
 * every member's personal integrations as well as org-level ones).
 */
export async function listIntegrations(orgId: string) {
  return prisma.integration.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: INTEGRATION_SUMMARY_SELECT,
  });
}

/**
 * List the integrations a MEMBER may see: their own personal integrations
 * (userId = me) plus org-level/admin-managed ones (userId = null) in their org.
 * Never surfaces another member's personal integration.
 */
export async function listUserIntegrations(orgId: string, userId: string) {
  return prisma.integration.findMany({
    where: {
      orgId,
      OR: [{ userId }, { userId: null }],
    },
    orderBy: { createdAt: 'desc' },
    select: INTEGRATION_SUMMARY_SELECT,
  });
}

/**
 * Resolve an integration a member is allowed to MANAGE (disconnect / health).
 * Ownership rule: it must be in the member's org AND owned by them (userId =
 * me). Org-level (null userId) and other members' personal integrations are
 * NOT manageable here — those stay under the admin path. Returns null when the
 * integration does not exist or the member may not manage it.
 */
export async function getUserManagedIntegration(
  id: string,
  orgId: string,
  userId: string,
) {
  const integration = await prisma.integration.findUnique({
    where: { id },
    select: { id: true, orgId: true, userId: true },
  });
  if (!integration) return null;
  if (integration.orgId !== orgId) return null;
  if (integration.userId !== userId) return null;
  return integration;
}

/**
 * Get a single integration by ID.
 */
export async function getIntegration(id: string) {
  return prisma.integration.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      provider: true,
      status: true,
      enabled: true,
      healthCheckedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Connect a new integration: encrypt credentials, save to DB, connect gateway.
 */
export async function connectIntegration(orgId: string, params: ConnectParams) {
  // Encrypt the credentials before storing
  const encryptedCredentials = encrypt(JSON.stringify(params.credentials));

  const configData: Record<string, string> = { encryptedCredentials };
  if (params.serverUrl) configData['serverUrl'] = params.serverUrl;
  if (params.label) configData['label'] = params.label;

  const integration = await prisma.integration.create({
    data: {
      orgId,
      // Personal connect: scope the integration to the connecting member so
      // only they see/manage it and the backfill/aha attribute to them. When
      // userId is undefined (the admin/org-level path) this stays null =
      // org-level/admin-managed, preserving the existing behavior.
      userId: params.userId ?? null,
      provider: params.provider,
      config: configData,
      status: 'active',
      enabled: true,
    },
  });

  // Connect via MCP gateway
  const connectorConfig: ConnectorConfig = {
    provider: params.provider,
    credentials: params.credentials,
    serverUrl: params.serverUrl,
  };

  try {
    await mcpGateway.connect(integration.id, connectorConfig);
  } catch (err) {
    // Update status to error if connection fails
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: 'error' },
    });
    throw err;
  }

  // ON-CONNECT BACKFILL — turn a connect into immediate value instead of a
  // 24h dead-zone. Fire-and-forget + non-blocking: a queue hiccup must never
  // fail the connect itself. Idempotent: synthesis dedups by embedding,
  // task detection dedups by title, and the backfill job uses a stable jobId.
  void enqueueOnConnectBackfill(orgId, integration.id, params.userId).catch((err) => {
    logger.error(
      { err, integrationId: integration.id, orgId },
      'Failed to enqueue on-connect backfill (non-fatal)',
    );
  });

  // Onboarding: connecting an integration is the activation AHA path. Mark the
  // connect_integration step complete from this real server-side action so we
  // never trust the client. Best-effort + non-blocking: a failure here must
  // never fail the connect itself. Idempotent in onboarding-service.
  if (params.userId) {
    void markStepComplete(params.userId, 'connect_integration').catch((err) => {
      logger.error(
        { err, integrationId: integration.id, userId: params.userId },
        'Failed to mark connect_integration onboarding step (non-fatal)',
      );
    });
  }

  return {
    id: integration.id,
    provider: integration.provider,
    status: integration.status,
    enabled: integration.enabled,
    createdAt: integration.createdAt,
  };
}

/**
 * Enqueue the on-connect backfill for a newly-connected integration.
 *
 * A SINGLE work-intake `connect_backfill` job (carrying userId + integrationId)
 * does both halves of the backfill, scoped to THIS integration:
 *   (a) a memory-synthesis pass — pulls recent content into the user's memory
 *   (b) a task-detection pass — surfaces actionable items as tasks
 *
 * Both run in the worker process, which self-heals the cross-process gateway gap
 * via mcpGateway.ensureConnected (the connect happened in the API process). We
 * deliberately do NOT fan an unscoped synthesis job out across the org: that
 * pulled from every org integration (including stale/seeded ones with bad creds)
 * and never targeted the source the user just connected.
 *
 * Integrations are org-scoped. If we know which user connected it we attribute
 * to them; otherwise we attribute to the first org user so the shared source
 * still produces value. Errors are logged, never thrown.
 */
async function enqueueOnConnectBackfill(
  orgId: string,
  integrationId: string,
  userId?: string,
): Promise<void> {
  let attributedUserId = userId;
  if (!attributedUserId) {
    const firstUser = await prisma.user.findFirst({
      where: { team: { orgId } },
      select: { id: true },
    });
    attributedUserId = firstUser?.id;
  }

  if (!attributedUserId) {
    logger.warn({ orgId, integrationId }, 'On-connect backfill: no users to synthesize for');
    return;
  }

  // One scoped job does synthesis + task detection from THIS integration.
  await enqueueConnectBackfill(attributedUserId, integrationId);

  logger.info(
    { orgId, integrationId, userId: attributedUserId },
    'On-connect backfill enqueued (scoped synthesis + task detection)',
  );
}

/**
 * Update an integration's credentials or enabled state.
 */
export async function updateIntegration(
  id: string,
  updates: { credentials?: Record<string, string>; enabled?: boolean },
) {
  const existing = await prisma.integration.findUnique({ where: { id } });
  if (!existing) {
    throw new Error('Integration not found');
  }

  const data: Record<string, unknown> = {};

  if (updates.credentials) {
    data['config'] = { encryptedCredentials: encrypt(JSON.stringify(updates.credentials)) };

    // Reconnect with new credentials
    const connectorConfig: ConnectorConfig = {
      provider: existing.provider,
      credentials: updates.credentials,
    };
    await mcpGateway.connect(id, connectorConfig);
    data['status'] = 'active';
  }

  if (updates.enabled !== undefined) {
    data['enabled'] = updates.enabled;
    if (!updates.enabled) {
      await mcpGateway.disconnect(id);
      data['status'] = 'inactive';
    } else {
      data['status'] = 'active';
    }
  }

  return prisma.integration.update({
    where: { id },
    data,
    select: {
      id: true,
      provider: true,
      status: true,
      enabled: true,
      healthCheckedAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Disconnect and remove an integration.
 */
export async function disconnectIntegration(id: string) {
  await mcpGateway.disconnect(id);
  await prisma.integration.delete({ where: { id } });
}

/**
 * Load credentials from DB for a given integration (decrypting them).
 */
export function decryptIntegrationCredentials(config: Record<string, unknown>): Record<string, string> {
  const encrypted = config['encryptedCredentials'] as string;
  if (!encrypted) {
    return {};
  }
  return JSON.parse(decrypt(encrypted)) as Record<string, string>;
}
