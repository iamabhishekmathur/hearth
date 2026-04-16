import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { mcpGateway } from './gateway.js';
import { decryptIntegrationCredentials } from '../services/integration-service.js';
import type { ConnectorConfig } from './connectors/base-connector.js';

/**
 * Loads all enabled integrations from the DB and connects them to the MCP gateway.
 * Call on server and worker startup so that integration tools are available at runtime.
 */
export async function bootstrapIntegrations(): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: { enabled: true },
  });

  if (integrations.length === 0) {
    logger.info('No enabled integrations to bootstrap');
    return;
  }

  let connected = 0;
  let failed = 0;

  for (const integ of integrations) {
    try {
      const config = (integ.config ?? {}) as Record<string, unknown>;

      // Decrypt stored credentials
      let credentials: Record<string, string>;
      try {
        credentials = decryptIntegrationCredentials(config);
      } catch {
        // Credentials may be dummy/sample — pass empty and let mock mode handle it
        credentials = {};
      }

      const connectorConfig: ConnectorConfig = {
        provider: integ.provider,
        credentials,
        serverUrl: (config['serverUrl'] as string) ?? undefined,
      };

      await mcpGateway.connect(integ.id, connectorConfig);
      connected++;
    } catch (err) {
      failed++;
      logger.warn(
        { integrationId: integ.id, provider: integ.provider, error: err },
        'Failed to bootstrap integration — skipping',
      );

      // Mark as error in DB so the UI shows the right status
      await prisma.integration.update({
        where: { id: integ.id },
        data: { status: 'error' },
      }).catch(() => {});
    }
  }

  logger.info(
    { total: integrations.length, connected, failed },
    'Integration bootstrap complete',
  );
}
