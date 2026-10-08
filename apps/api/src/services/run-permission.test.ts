import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./chat-service.js', () => ({
  getSessionWriteAccess: vi.fn(),
}));
vi.mock('../agent/run-registry.js', () => ({
  getActiveRun: vi.fn(),
}));

import { canStopRun } from './run-permission.js';
import { getSessionWriteAccess } from './chat-service.js';
import { getActiveRun } from '../agent/run-registry.js';

const mockedWriteAccess = vi.mocked(getSessionWriteAccess);
const mockedGetActiveRun = vi.mocked(getActiveRun);

describe('canStopRun (W2 stop permission)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owner may stop', async () => {
    mockedWriteAccess.mockResolvedValue('owner');
    expect(await canStopRun('s1', 'owner-user')).toBe(true);
  });

  it('contributor may stop', async () => {
    mockedWriteAccess.mockResolvedValue('contributor');
    expect(await canStopRun('s1', 'contrib-user')).toBe(true);
  });

  // ── §5.1 case 18: a pure viewer (no write access) may NOT stop → 403 ──
  it('case 18: a pure viewer may not stop', async () => {
    mockedWriteAccess.mockResolvedValue(null);
    mockedGetActiveRun.mockReturnValue(undefined);
    expect(await canStopRun('s1', 'viewer-user')).toBe(false);
  });

  it('the run initiator may stop even without write access (defensive)', async () => {
    mockedWriteAccess.mockResolvedValue(null);
    mockedGetActiveRun.mockReturnValue({
      runId: 'run-1',
      sessionId: 's1',
      initiatorUserId: 'initiator',
      controller: new AbortController(),
    });
    expect(await canStopRun('s1', 'initiator', 'run-1')).toBe(true);
    // A different user who is the initiator-of-nothing still can't.
    expect(await canStopRun('s1', 'random', 'run-1')).toBe(false);
  });
});
