import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';

// ── Mocks ──
const { store, cred } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  cred: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
    deleteMany: vi.fn(),
  },
}));
vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    getdel: vi.fn(async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma: { userLlmCredential: cred } }));

import { env } from '../config.js';
import { encrypt, decrypt } from '../mcp/token-store.js';
import * as svc from './chatgpt-plan-service.js';
import { ChatGPTAuthError, PLAN_USAGE_SCOPE } from './chatgpt-plan-service.js';

// ── OIDC fixtures ──
const ISSUER = 'https://auth.openai.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function idToken(claims: Record<string, unknown>, kid = 'k1'): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}

let tokenResponses: Array<{ status: number; body: Record<string, unknown> }> = [];
const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.endsWith('/.well-known/openid-configuration')) {
    return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` });
  }
  if (u.endsWith('/jwks')) return Response.json({ keys: [jwk] });
  if (u.endsWith('/api/accounts/oauth/token')) {
    const next = tokenResponses.shift() ?? { status: 500, body: {} };
    (fetchMock as unknown as { lastTokenBody?: URLSearchParams }).lastTokenBody =
      new URLSearchParams(String(init?.body ?? ''));
    return Response.json(next.body, { status: next.status });
  }
  if (u.endsWith('/oauth/revoke')) {
    (fetchMock as unknown as { lastRevokeBody?: URLSearchParams }).lastRevokeBody =
      new URLSearchParams(String(init?.body ?? ''));
    return new Response(null, { status: 200 });
  }
  if (u.endsWith('/models')) {
    return Response.json({
      models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
        { slug: 'internal', display_name: 'Hidden', visibility: 'hide' },
      ],
    });
  }
  throw new Error(`unexpected fetch ${u}`);
});

beforeEach(() => {
  store.clear();
  tokenResponses = [];
  vi.clearAllMocks();
  svc._resetOidcCaches();
  vi.stubGlobal('fetch', fetchMock);
  (env as { CHATGPT_PLAN_ENABLED: boolean }).CHATGPT_PLAN_ENABLED = true;
  (env as { CHATGPT_CLIENT_ID?: string }).CHATGPT_CLIENT_ID = undefined;
  cred.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

async function start(): Promise<{ url: URL; state: string }> {
  const url = new URL(await svc.startAuthorization({ id: 'user-1', orgId: 'org-1' }));
  return { url, state: url.searchParams.get('state')! };
}

function pendingNonce(state: string): string {
  return JSON.parse(store.get(`chatgpt:oauth:pending:${state}`)!).nonce;
}

describe('startAuthorization', () => {
  it('builds a PKCE S256 request with dynamic registration and a 127.0.0.1 loopback redirect', async () => {
    const { url, state } = await start();
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('dynamic_agent_client');
    expect(q.get('agent_name_hint')).toBe('Hearth');
    expect(q.get('ext_agent_host_id')).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(q.get('scope')!.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'offline_access', 'resource.invoke', PLAN_USAGE_SCOPE]),
    );
    expect(q.get('resource')).toBe('https://api.openai.com/v1');
    expect(q.get('code_challenge_method')).toBe('S256');
    const redirect = new URL(q.get('redirect_uri')!);
    expect(redirect.hostname).toBe('127.0.0.1'); // `localhost` is rejected by OpenAI
    expect(redirect.pathname).toBe('/api/v1/auth/chatgpt/callback');

    const pending = JSON.parse(store.get(`chatgpt:oauth:pending:${state}`)!);
    expect(pending.userId).toBe('user-1');
    const expected = createHash('sha256').update(pending.verifier).digest('base64url');
    expect(q.get('code_challenge')).toBe(expected);
  });

  it('reuses the client id previously issued to this user', async () => {
    cred.findUnique.mockResolvedValue({ clientId: 'oaiapp_abc' });
    const { url } = await start();
    expect(url.searchParams.get('client_id')).toBe('oaiapp_abc');
    expect(url.searchParams.has('agent_name_hint')).toBe(false);
    // Host id is sent on every open-source authorize, and stays the same.
    expect(url.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/);
  });

  it('uses the static hosted client id when configured', async () => {
    (env as { CHATGPT_CLIENT_ID?: string }).CHATGPT_CLIENT_ID = 'hosted_client';
    const { url } = await start();
    expect(url.searchParams.get('client_id')).toBe('hosted_client');
    expect(svc.chatgptMode()).toBe('hosted');
  });

  it('refuses when the feature is disabled', async () => {
    (env as { CHATGPT_PLAN_ENABLED: boolean }).CHATGPT_PLAN_ENABLED = false;
    await expect(start()).rejects.toMatchObject({ code: 'not_enabled' });
  });

  it('generates unique state per attempt', async () => {
    const a = await start();
    const b = await start();
    expect(a.state).not.toBe(b.state);
  });
});

describe('completeAuthorization', () => {
  function goodTokens(state: string, overrides: Record<string, unknown> = {}) {
    return {
      status: 200,
      body: {
        access_token: 'at_1',
        refresh_token: 'rt_1',
        expires_in: 3600,
        scope: `openid profile email offline_access resource.invoke ${PLAN_USAGE_SCOPE}`,
        id_token: idToken({
          iss: ISSUER,
          aud: 'oaiapp_issued',
          sub: 'acct_1',
          email: 'a@example.com',
          exp: Math.floor(Date.now() / 1000) + 600,
          nonce: pendingNonce(state),
        }),
        ...overrides,
      },
    };
  }

  it('exchanges the code with the PKCE verifier and stores encrypted tokens', async () => {
    const { state } = await start();
    const verifier = JSON.parse(store.get(`chatgpt:oauth:pending:${state}`)!).verifier;
    tokenResponses.push(goodTokens(state));
    const result = await svc.completeAuthorization({
      code: 'c1',
      state,
      client_id: 'oaiapp_issued',
    });
    expect(result).toEqual({ userId: 'user-1', orgId: 'org-1', accountEmail: 'a@example.com' });

    const body = (fetchMock as unknown as { lastTokenBody: URLSearchParams }).lastTokenBody;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe(verifier);
    expect(body.get('client_id')).toBe('oaiapp_issued');

    const call = cred.upsert.mock.calls[0]![0];
    expect(call.create.clientId).toBe('oaiapp_issued');
    expect(call.create.accountSubject).toBe('acct_1');
    expect(call.create.encryptedAccessToken).not.toContain('at_1');
    expect(decrypt(call.create.encryptedAccessToken)).toBe('at_1');
    expect(decrypt(call.create.encryptedRefreshToken)).toBe('rt_1');
  });

  it('state is single-use (replay rejected)', async () => {
    const { state } = await start();
    tokenResponses.push(goodTokens(state));
    await svc.completeAuthorization({ code: 'c1', state, client_id: 'oaiapp_issued' });
    await expect(
      svc.completeAuthorization({ code: 'c1', state, client_id: 'oaiapp_issued' }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('rejects unknown state', async () => {
    await expect(svc.completeAuthorization({ code: 'c', state: 'forged' })).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('does not exchange the code when the user denied access', async () => {
    const { state } = await start();
    await expect(
      svc.completeAuthorization({ error: 'access_denied', state }),
    ).rejects.toMatchObject({
      code: 'access_denied',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to store tokens when plan usage scope was not granted', async () => {
    const { state } = await start();
    tokenResponses.push(goodTokens(state, { scope: 'openid profile email offline_access' }));
    await expect(
      svc.completeAuthorization({ code: 'c', state, client_id: 'oaiapp_issued' }),
    ).rejects.toMatchObject({
      code: 'plan_not_granted',
    });
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong nonce', { nonce: 'other' }],
    ['wrong audience', { aud: 'someone_else' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }],
  ])('rejects an ID token with %s', async (_label, bad) => {
    const { state } = await start();
    const good = goodTokens(state);
    const claims = JSON.parse(
      Buffer.from(String(good.body.id_token).split('.')[1]!, 'base64url').toString(),
    );
    tokenResponses.push(goodTokens(state, { id_token: idToken({ ...claims, ...bad }) }));
    await expect(
      svc.completeAuthorization({ code: 'c', state, client_id: 'oaiapp_issued' }),
    ).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it('rejects a tampered ID token signature', async () => {
    const { state } = await start();
    const good = goodTokens(state);
    const [h, , s] = String(good.body.id_token).split('.');
    const p = Buffer.from(
      JSON.stringify({ sub: 'attacker', iss: ISSUER, aud: 'oaiapp_issued', exp: 9e9 }),
    ).toString('base64url');
    tokenResponses.push(goodTokens(state, { id_token: `${h}.${p}.${s}` }));
    await expect(
      svc.completeAuthorization({ code: 'c', state, client_id: 'oaiapp_issued' }),
    ).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
  });

  it('will not silently swap the connected ChatGPT account', async () => {
    const { state } = await start();
    cred.findUnique.mockResolvedValue({ accountSubject: 'acct_OTHER' });
    tokenResponses.push(goodTokens(state));
    await expect(
      svc.completeAuthorization({ code: 'c', state, client_id: 'oaiapp_issued' }),
    ).rejects.toMatchObject({
      code: 'account_mismatch',
    });
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it('requires an issued client id on dynamic registration callbacks', async () => {
    const { state } = await start();
    await expect(svc.completeAuthorization({ code: 'c', state })).rejects.toBeInstanceOf(
      ChatGPTAuthError,
    );
  });
});

describe('getAccessToken', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'cred-1',
    clientId: 'oaiapp_issued',
    status: 'active',
    scopes: [PLAN_USAGE_SCOPE],
    encryptedAccessToken: encrypt('at_old'),
    encryptedRefreshToken: encrypt('rt_old'),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  });

  it('returns the stored token when not near expiry', async () => {
    cred.findUnique.mockResolvedValue(row());
    expect(await svc.getAccessToken('user-1')).toBe('at_old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes near expiry and rotates access + refresh tokens together', async () => {
    cred.findUnique.mockResolvedValue(row({ accessTokenExpiresAt: new Date(Date.now() + 10_000) }));
    tokenResponses.push({
      status: 200,
      body: {
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        scope: PLAN_USAGE_SCOPE,
      },
    });
    expect(await svc.getAccessToken('user-1')).toBe('at_new');
    const body = (fetchMock as unknown as { lastTokenBody: URLSearchParams }).lastTokenBody;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt_old');
    const data = cred.update.mock.calls[0]![0].data;
    expect(decrypt(data.encryptedAccessToken)).toBe('at_new');
    expect(decrypt(data.encryptedRefreshToken)).toBe('rt_new');
    expect(data.status).toBe('active');
  });

  it('dedupes concurrent refreshes (a rotated refresh token is single-use)', async () => {
    cred.findUnique.mockResolvedValue(row({ accessTokenExpiresAt: new Date(Date.now() + 10_000) }));
    tokenResponses.push({
      status: 200,
      body: { access_token: 'at_new', refresh_token: 'rt_new', expires_in: 3600 },
    });
    const results = await Promise.all([
      svc.getAccessToken('user-1'),
      svc.getAccessToken('user-1'),
      svc.getAccessToken('user-1'),
    ]);
    expect(results).toEqual(['at_new', 'at_new', 'at_new']);
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('marks the connection needs_reauth on invalid_grant', async () => {
    cred.findUnique.mockResolvedValue(row({ accessTokenExpiresAt: new Date(Date.now() - 1000) }));
    tokenResponses.push({ status: 400, body: { error: 'invalid_grant' } });
    await expect(svc.getAccessToken('user-1')).rejects.toMatchObject({ code: 'needs_reauth' });
    expect(cred.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'needs_reauth' } }),
    );
  });

  it('throws not_connected / needs_reauth without calling OpenAI', async () => {
    cred.findUnique.mockResolvedValue(null);
    await expect(svc.getAccessToken('u')).rejects.toMatchObject({ code: 'not_connected' });
    cred.findUnique.mockResolvedValue(row({ status: 'needs_reauth' }));
    await expect(svc.getAccessToken('u')).rejects.toMatchObject({ code: 'needs_reauth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listPlanModels / routing', () => {
  it('only returns models with visibility "list"', async () => {
    cred.findUnique.mockResolvedValue({
      status: 'active',
      encryptedAccessToken: encrypt('at'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    expect(await svc.listPlanModels('u')).toEqual([
      { id: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' },
    ]);
  });

  it('routes chats only when connected and toggled on', async () => {
    cred.findUnique.mockResolvedValue(null);
    expect((await svc.resolveChatRouting('u')).useChatGPTPlan).toBe(false);
    cred.findUnique.mockResolvedValue({ useForChat: false, status: 'active', defaultModel: null });
    expect((await svc.resolveChatRouting('u')).useChatGPTPlan).toBe(false);
    cred.findUnique.mockResolvedValue({
      useForChat: true,
      status: 'needs_reauth',
      defaultModel: 'm',
    });
    expect(await svc.resolveChatRouting('u')).toEqual({ useChatGPTPlan: true, defaultModel: 'm' });
    (env as { CHATGPT_PLAN_ENABLED: boolean }).CHATGPT_PLAN_ENABLED = false;
    expect((await svc.resolveChatRouting('u')).useChatGPTPlan).toBe(false);
  });
});

describe('disconnect', () => {
  it('revokes the refresh token at OpenAI, then deletes local tokens', async () => {
    cred.findUnique.mockResolvedValue({
      clientId: 'oaiapp_issued',
      encryptedRefreshToken: encrypt('rt_live'),
    });
    await svc.disconnect('user-1');
    const body = (fetchMock as unknown as { lastRevokeBody: URLSearchParams }).lastRevokeBody;
    expect(body.get('token')).toBe('rt_live');
    expect(body.get('token_type_hint')).toBe('refresh_token');
    expect(body.get('client_id')).toBe('oaiapp_issued');
    expect(cred.deleteMany).toHaveBeenCalled();
  });

  it('still deletes local tokens when revocation fails', async () => {
    cred.findUnique.mockResolvedValue({ clientId: 'c', encryptedRefreshToken: encrypt('rt') });
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    await svc.disconnect('user-1');
    expect(cred.deleteMany).toHaveBeenCalled();
  });
});
