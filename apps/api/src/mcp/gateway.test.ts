import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// prisma: capture health-persist writes + serve integration rows for ensureConnected
const { updateMany, findUnique } = vi.hoisted(() => ({
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  findUnique: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: { integration: { updateMany, findUnique } },
}));

// token-store: deterministic decrypt for ensureConnected credential loading
vi.mock('./token-store.js', () => ({
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));

// ConnectionManager: control which integrations are "connected" and their health
const connections = new Map<string, { connector: { healthCheck: () => Promise<boolean> }; config: { provider: string }; lastHealthCheck: Date | null; healthy: boolean }>();
const connectSpy = vi.fn(async (id: string, config: { provider: string }) => {
  connections.set(id, {
    connector: { healthCheck: async () => true },
    config,
    lastHealthCheck: new Date(),
    healthy: true,
  });
});
vi.mock('./connection-manager.js', () => ({
  ConnectionManager: class {
    getConnection(id: string) {
      return connections.get(id);
    }
    getConnectedIds() {
      return [...connections.keys()];
    }
    isConnected(id: string) {
      return connections.has(id);
    }
    connect(id: string, config: { provider: string }) {
      return connectSpy(id, config);
    }
    destroy() {}
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { MCPGatewayImpl } from './gateway.js';

describe('MCPGatewayImpl.healthCheck — persists status (fix: integration-activation)', () => {
  let gateway: MCPGatewayImpl;

  beforeEach(() => {
    connections.clear();
    updateMany.mockClear();
    gateway = new MCPGatewayImpl();
  });

  it("persists status 'active' + healthCheckedAt when the connector is healthy", async () => {
    connections.set('int-1', {
      connector: { healthCheck: async () => true },
      config: { provider: 'custom' },
      lastHealthCheck: null,
      healthy: true,
    });

    const result = await gateway.healthCheck('int-1');

    expect(result.healthy).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'int-1', enabled: true });
    expect(arg.data.status).toBe('active');
    expect(arg.data.healthCheckedAt).toBeInstanceOf(Date);
  });

  it("persists status 'error' when the connector health probe fails (no longer stuck 'active')", async () => {
    connections.set('int-2', {
      connector: { healthCheck: async () => false }, // e.g. broken/revoked token
      config: { provider: 'custom' },
      lastHealthCheck: null,
      healthy: true,
    });

    const result = await gateway.healthCheck('int-2');

    expect(result.healthy).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data.status).toBe('error');
  });

  it("persists 'error' when the integration is not connected to the gateway at all", async () => {
    const result = await gateway.healthCheck('int-missing');

    expect(result.connected).toBe(false);
    expect(result.healthy).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data.status).toBe('error');
    expect(updateMany.mock.calls[0][0].data.healthCheckedAt).toBeInstanceOf(Date);
  });

  it('does not throw if the DB write fails (best-effort persistence)', async () => {
    updateMany.mockRejectedValueOnce(new Error('db down'));
    connections.set('int-3', {
      connector: { healthCheck: async () => true },
      config: { provider: 'custom' },
      lastHealthCheck: null,
      healthy: true,
    });

    await expect(gateway.healthCheck('int-3')).resolves.toMatchObject({ healthy: true });
  });

  it('only updates enabled integrations (never resurrects a disabled one)', async () => {
    connections.set('int-4', {
      connector: { healthCheck: async () => true },
      config: { provider: 'custom' },
      lastHealthCheck: null,
      healthy: true,
    });

    await gateway.healthCheck('int-4');
    expect(updateMany.mock.calls[0][0].where.enabled).toBe(true);
  });
});

describe('MCPGatewayImpl.ensureConnected — cross-process on-demand connect (fix: integration-pull-crossprocess)', () => {
  let gateway: MCPGatewayImpl;

  beforeEach(() => {
    connections.clear();
    findUnique.mockReset();
    connectSpy.mockClear();
    gateway = new MCPGatewayImpl();
  });

  it('is a no-op (returns true, no DB load) when already connected in this process', async () => {
    connections.set('int-live', {
      connector: { healthCheck: async () => true },
      config: { provider: 'custom' },
      lastHealthCheck: null,
      healthy: true,
    });

    const ok = await gateway.ensureConnected('int-live');

    expect(ok).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('loads the row, decrypts creds, and connects on-demand when NOT connected (worker process)', async () => {
    findUnique.mockResolvedValue({
      id: 'int-new',
      provider: 'custom',
      enabled: true,
      config: {
        encryptedCredentials: 'enc:' + JSON.stringify({ server_url: 'http://127.0.0.1:9' }),
        serverUrl: 'http://127.0.0.1:9',
      },
    });

    const ok = await gateway.ensureConnected('int-new');

    expect(ok).toBe(true);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    const [id, config] = connectSpy.mock.calls[0];
    expect(id).toBe('int-new');
    expect(config).toMatchObject({
      provider: 'custom',
      serverUrl: 'http://127.0.0.1:9',
      credentials: { server_url: 'http://127.0.0.1:9' },
    });
    // and it is now live in-process
    expect(gateway.getConnectedIntegrations()).toContain('int-new');
  });

  it('returns false when the integration row is missing', async () => {
    findUnique.mockResolvedValue(null);
    expect(await gateway.ensureConnected('nope')).toBe(false);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('returns false (does not connect) when the integration is disabled', async () => {
    findUnique.mockResolvedValue({
      id: 'int-off',
      provider: 'custom',
      enabled: false,
      config: { encryptedCredentials: 'enc:{}' },
    });
    expect(await gateway.ensureConnected('int-off')).toBe(false);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('returns false when the on-demand connect throws', async () => {
    findUnique.mockResolvedValue({
      id: 'int-bad',
      provider: 'custom',
      enabled: true,
      config: { encryptedCredentials: 'enc:' + JSON.stringify({ server_url: 'x' }) },
    });
    connectSpy.mockRejectedValueOnce(new Error('cannot reach server'));
    expect(await gateway.ensureConnected('int-bad')).toBe(false);
  });
});
