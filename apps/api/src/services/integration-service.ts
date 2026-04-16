import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../mcp/token-store.js';
import { mcpGateway } from '../mcp/gateway.js';
import type { ConnectorConfig } from '../mcp/connectors/base-connector.js';

interface ConnectParams {
  provider: string;
  credentials: Record<string, string>;
  serverUrl?: string;
  label?: string;
}

/**
 * List all integrations for an organization.
 */
export async function listIntegrations(orgId: string) {
  return prisma.integration.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      status: true,
      enabled: true,
      healthCheckedAt: true,
      createdAt: true,
      updatedAt: true,
      // Omit config — contains encrypted credentials
    },
  });
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

  return {
    id: integration.id,
    provider: integration.provider,
    status: integration.status,
    enabled: integration.enabled,
    createdAt: integration.createdAt,
  };
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
