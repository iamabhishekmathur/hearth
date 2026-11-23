/**
 * Sign in with ChatGPT — "Use your ChatGPT plan".
 *
 * Lets a signed-in Hearth user (Google / email / SSO) connect their ChatGPT
 * account so their own chats spend their ChatGPT plan allowance instead of the
 * org's API key. Implements OpenAI's documented flow:
 *   https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 *
 * - OAuth 2.0 authorization code + PKCE (S256), public client (no secret).
 * - Open-source installs register dynamically (`client_id=dynamic_agent_client`)
 *   and must use a 127.0.0.1 loopback redirect. Hosted deployments approved by
 *   OpenAI set CHATGPT_CLIENT_ID + CHATGPT_REDIRECT_URI instead.
 * - Plan usage requires the `chatgpt.tokens.use.direct` scope to be *granted*;
 *   a valid ID token alone is not enough.
 * - Refresh tokens rotate: access token, expiry, scopes and refresh token are
 *   replaced together, under a lock so concurrent requests don't double-spend
 *   a rotated refresh token.
 *
 * The OAuth callback lands on 127.0.0.1, which does not carry the user's
 * `localhost`/hosted session cookie, so in-flight state lives in Redis keyed by
 * the one-time `state` value rather than in the session.
 */
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { env } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { runWithTenant } from '../lib/tenant-context.js';
import { encrypt, decrypt } from '../mcp/token-store.js';

export const CHATGPT_PROVIDER = 'chatgpt';
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';
export const CHATGPT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  PLAN_USAGE_SCOPE,
];
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const PENDING_TTL_SECONDS = 600;
/** Refresh this long before expiry so a streaming request doesn't expire mid-flight. */
const REFRESH_SKEW_MS = 120_000;

/** Where users manage per-app usage caps (ChatGPT settings → Security and login). */
export const CHATGPT_MANAGE_USAGE_URL = 'https://chatgpt.com/#settings/Security';
export const CHATGPT_HELP_URL =
  'https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites';

// ── Errors ────────────────────────────────────────────────────────────────────

export type ChatGPTAuthErrorCode =
  | 'not_enabled'
  | 'invalid_state'
  | 'access_denied'
  | 'plan_not_granted'
  | 'token_exchange_failed'
  | 'invalid_id_token'
  | 'account_mismatch'
  | 'not_connected'
  | 'needs_reauth';

export class ChatGPTAuthError extends Error {
  constructor(
    public readonly code: ChatGPTAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChatGPTAuthError';
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

export function isChatGPTPlanEnabled(): boolean {
  return env.CHATGPT_PLAN_ENABLED === true;
}

/** Hosted (OpenAI-approved static client) vs open-source dynamic registration. */
export function chatgptMode(): 'hosted' | 'open_source' {
  return env.CHATGPT_CLIENT_ID ? 'hosted' : 'open_source';
}

export function chatgptRedirectUri(): string {
  return (
    env.CHATGPT_REDIRECT_URI ?? `http://127.0.0.1:${env.API_PORT}/api/v1/auth/chatgpt/callback`
  );
}

/**
 * Stable per-install agent host id (`ext_agent_host_id`). Derived, not random,
 * so every API replica of one install agrees without shared state. Hashing the
 * encryption key makes it unguessable without revealing the key.
 */
export function agentHostId(): string {
  // OpenAI expects a URN UUID (`urn:uuid:...`). Build a name-based (v5-style)
  // UUID from the digest so the value stays stable for this install.
  const b = createHash('sha256')
    .update(`hearth-agent-host:${env.API_URL}:${env.ENCRYPTION_KEY}`)
    .digest()
    .subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString('hex');
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function authUrl(path: string): string {
  return `${env.CHATGPT_AUTH_BASE_URL.replace(/\/$/, '')}${path}`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

// ── Authorization start ───────────────────────────────────────────────────────

interface PendingAuth {
  userId: string;
  orgId: string;
  nonce: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}

const pendingKey = (state: string) => `chatgpt:oauth:pending:${state}`;

/**
 * Build the authorize URL for a user and stash the PKCE verifier / nonce under
 * a single-use `state`. Reuses the client id previously issued to this user's
 * connection (dynamic registration issues one on first sign-in).
 */
export async function startAuthorization(user: { id: string; orgId: string }): Promise<string> {
  if (!isChatGPTPlanEnabled()) {
    throw new ChatGPTAuthError('not_enabled', 'ChatGPT plan usage is not enabled on this server');
  }

  const existing = await prisma.userLlmCredential.findUnique({
    where: { userId_provider: { userId: user.id, provider: CHATGPT_PROVIDER } },
    select: { clientId: true },
  });
  const clientId = env.CHATGPT_CLIENT_ID ?? existing?.clientId ?? DYNAMIC_CLIENT_ID;

  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const redirectUri = chatgptRedirectUri();

  const pending: PendingAuth = {
    userId: user.id,
    orgId: user.orgId,
    nonce,
    verifier,
    clientId,
    redirectUri,
  };
  await redis.set(pendingKey(state), JSON.stringify(pending), 'EX', PENDING_TTL_SECONDS);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: CHATGPT_SCOPES.join(' '),
    resource: env.CHATGPT_API_BASE_URL,
    state,
    nonce,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  // Open-source mode: the host id is required on every authorize request
  // (same value each time); the name hint only on first, dynamic registration.
  if (chatgptMode() === 'open_source') {
    params.set('ext_agent_host_id', agentHostId());
    if (clientId === DYNAMIC_CLIENT_ID) params.set('agent_name_hint', 'Hearth');
  }
  return `${authUrl('/api/accounts/authorize')}?${params.toString()}`;
}

// ── Callback / token exchange ─────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(authUrl('/api/accounts/oauth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    const err = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    throw new ChatGPTAuthError(
      err === 'invalid_grant' ? 'needs_reauth' : 'token_exchange_failed',
      `ChatGPT token endpoint returned ${err}`,
    );
  }
  return json as unknown as TokenResponse;
}

export function parseScopes(scope: string | undefined): string[] {
  return (scope ?? '').split(/[\s+]+/).filter(Boolean);
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  client_id?: string;
  scope?: string;
}

export interface ConnectResult {
  userId: string;
  orgId: string;
  accountEmail: string | null;
}

/**
 * Complete the OAuth callback: validate state, exchange the code, verify the
 * ID token, confirm plan-usage scope, and persist encrypted tokens.
 */
export async function completeAuthorization(query: CallbackQuery): Promise<ConnectResult> {
  if (!query.state) throw new ChatGPTAuthError('invalid_state', 'Missing state');
  // Single use: GETDEL so a replayed callback can't reuse the verifier.
  const raw = await redis.getdel(pendingKey(query.state));
  if (!raw) throw new ChatGPTAuthError('invalid_state', 'Unknown or expired state');
  const pending = JSON.parse(raw) as PendingAuth;

  if (query.error) {
    // access_denied: user declined. Don't exchange the code.
    throw new ChatGPTAuthError(
      query.error === 'access_denied' ? 'access_denied' : 'token_exchange_failed',
      query.error_description ?? query.error,
    );
  }
  if (!query.code)
    throw new ChatGPTAuthError('token_exchange_failed', 'Missing authorization code');

  // Dynamic registration returns the issued client id on the callback.
  const clientId =
    pending.clientId === DYNAMIC_CLIENT_ID ? (query.client_id ?? '') : pending.clientId;
  if (!clientId || clientId === DYNAMIC_CLIENT_ID) {
    throw new ChatGPTAuthError(
      'token_exchange_failed',
      'Callback did not include an issued client_id',
    );
  }

  const tokens = await postToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: query.code,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
    resource: env.CHATGPT_API_BASE_URL,
  });

  if (!tokens.id_token) throw new ChatGPTAuthError('invalid_id_token', 'No ID token returned');
  const claims = await verifyIdToken(tokens.id_token, { clientId, nonce: pending.nonce });

  const scopes = parseScopes(tokens.scope ?? query.scope);
  if (!scopes.includes(PLAN_USAGE_SCOPE)) {
    throw new ChatGPTAuthError(
      'plan_not_granted',
      'ChatGPT plan usage was not granted. You can allow it from ChatGPT and reconnect.',
    );
  }

  const accountEmail = typeof claims.email === 'string' ? claims.email : null;

  await runWithTenant({ orgId: pending.orgId, userId: pending.userId }, async () => {
    const existing = await prisma.userLlmCredential.findUnique({
      where: { userId_provider: { userId: pending.userId, provider: CHATGPT_PROVIDER } },
      select: { accountSubject: true },
    });
    // Re-auth must not silently swap the connected account.
    if (existing && existing.accountSubject !== claims.sub) {
      throw new ChatGPTAuthError(
        'account_mismatch',
        'A different ChatGPT account is already connected. Disconnect it first.',
      );
    }
    const data = {
      accountSubject: claims.sub,
      accountEmail,
      clientId,
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      scopes,
      status: 'active',
    };
    await prisma.userLlmCredential.upsert({
      where: { userId_provider: { userId: pending.userId, provider: CHATGPT_PROVIDER } },
      create: { ...data, orgId: pending.orgId, userId: pending.userId, provider: CHATGPT_PROVIDER },
      update: data,
    });
  });

  logger.info({ userId: pending.userId }, 'ChatGPT plan connected');
  return { userId: pending.userId, orgId: pending.orgId, accountEmail };
}

// ── ID token verification (RS256 via OIDC discovery + JWKS) ───────────────────

interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
  email?: string;
  [k: string]: unknown;
}

interface Discovery {
  issuer: string;
  jwks_uri: string;
}

let discoveryCache: { value: Discovery; at: number } | null = null;
let jwksCache: { keys: Array<JsonWebKey & { kid?: string }>; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

async function getDiscovery(): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < CACHE_MS) return discoveryCache.value;
  const res = await fetch(authUrl('/.well-known/openid-configuration'));
  if (!res.ok) throw new ChatGPTAuthError('invalid_id_token', 'OIDC discovery failed');
  const value = (await res.json()) as Discovery;
  discoveryCache = { value, at: Date.now() };
  return value;
}

async function getJwks(forceRefresh = false): Promise<Array<JsonWebKey & { kid?: string }>> {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.at < CACHE_MS) return jwksCache.keys;
  const { jwks_uri } = await getDiscovery();
  const res = await fetch(jwks_uri);
  if (!res.ok) throw new ChatGPTAuthError('invalid_id_token', 'JWKS fetch failed');
  const { keys } = (await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> };
  jwksCache = { keys, at: Date.now() };
  return keys;
}

/** Exported for tests. */
export function _resetOidcCaches(): void {
  discoveryCache = null;
  jwksCache = null;
}

export async function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new ChatGPTAuthError('invalid_id_token', 'Malformed ID token');
  const [h, p, sig] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw new ChatGPTAuthError('invalid_id_token', 'Malformed ID token');
  }
  if (header.alg !== 'RS256')
    throw new ChatGPTAuthError('invalid_id_token', `Unsupported alg ${header.alg}`);

  let keys = await getJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getJwks(true); // key rotation
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new ChatGPTAuthError('invalid_id_token', 'Signing key not found');

  const ok = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(sig, 'base64url'),
  );
  if (!ok) throw new ChatGPTAuthError('invalid_id_token', 'Bad ID token signature');

  const { issuer } = await getDiscovery();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer) throw new ChatGPTAuthError('invalid_id_token', 'Issuer mismatch');
  if (!aud.includes(expected.clientId))
    throw new ChatGPTAuthError('invalid_id_token', 'Audience mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) {
    throw new ChatGPTAuthError('invalid_id_token', 'ID token expired');
  }
  if (claims.nonce !== expected.nonce)
    throw new ChatGPTAuthError('invalid_id_token', 'Nonce mismatch');
  if (!claims.sub) throw new ChatGPTAuthError('invalid_id_token', 'Missing sub');
  return claims;
}

// ── Access tokens (with rotating refresh) ─────────────────────────────────────

const inflightRefresh = new Map<string, Promise<string>>();

/**
 * Return a non-expiring access token for the user's ChatGPT connection,
 * refreshing (and rotating the refresh token) when close to expiry.
 * Throws ChatGPTAuthError('not_connected' | 'needs_reauth').
 */
export async function getAccessToken(userId: string): Promise<string> {
  const cred = await prisma.userLlmCredential.findUnique({
    where: { userId_provider: { userId, provider: CHATGPT_PROVIDER } },
  });
  if (!cred) throw new ChatGPTAuthError('not_connected', 'ChatGPT plan is not connected');
  if (cred.status === 'needs_reauth') {
    throw new ChatGPTAuthError('needs_reauth', 'Reconnect your ChatGPT account');
  }
  if (cred.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
    return decrypt(cred.encryptedAccessToken);
  }

  // Dedupe concurrent refreshes in this process…
  const existing = inflightRefresh.get(userId);
  if (existing) return existing;
  const p = refreshWithLock(userId).finally(() => inflightRefresh.delete(userId));
  inflightRefresh.set(userId, p);
  return p;
}

async function refreshWithLock(userId: string): Promise<string> {
  // …and across replicas: a rotated refresh token can only be used once.
  const lockKey = `chatgpt:oauth:refresh-lock:${userId}`;
  const lockVal = b64url(randomBytes(12));
  for (let attempt = 0; attempt < 50; attempt++) {
    const got = await redis.set(lockKey, lockVal, 'PX', 15_000, 'NX');
    if (got) break;
    await new Promise((r) => setTimeout(r, 200));
    // Another replica may have refreshed already.
    const fresh = await prisma.userLlmCredential.findUnique({
      where: { userId_provider: { userId, provider: CHATGPT_PROVIDER } },
    });
    if (fresh && fresh.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
      return decrypt(fresh.encryptedAccessToken);
    }
  }

  try {
    const cred = await prisma.userLlmCredential.findUnique({
      where: { userId_provider: { userId, provider: CHATGPT_PROVIDER } },
    });
    if (!cred) throw new ChatGPTAuthError('not_connected', 'ChatGPT plan is not connected');
    if (cred.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
      return decrypt(cred.encryptedAccessToken);
    }
    if (!cred.encryptedRefreshToken) {
      await markNeedsReauth(userId);
      throw new ChatGPTAuthError('needs_reauth', 'Reconnect your ChatGPT account');
    }

    let tokens: TokenResponse;
    try {
      tokens = await postToken({
        grant_type: 'refresh_token',
        client_id: cred.clientId,
        refresh_token: decrypt(cred.encryptedRefreshToken),
        resource: env.CHATGPT_API_BASE_URL,
      });
    } catch (err) {
      if (err instanceof ChatGPTAuthError && err.code === 'needs_reauth')
        await markNeedsReauth(userId);
      throw err;
    }

    const scopes = tokens.scope ? parseScopes(tokens.scope) : cred.scopes;
    // Rotation: replace access token, expiry, scopes and refresh token together.
    await prisma.userLlmCredential.update({
      where: { id: cred.id },
      data: {
        encryptedAccessToken: encrypt(tokens.access_token),
        encryptedRefreshToken: tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : cred.encryptedRefreshToken,
        accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
        scopes,
        status: scopes.includes(PLAN_USAGE_SCOPE) ? 'active' : 'plan_unavailable',
      },
    });
    return tokens.access_token;
  } finally {
    // Release only our own lock.
    const current = await redis.get(lockKey);
    if (current === lockVal) await redis.del(lockKey);
  }
}

async function markNeedsReauth(userId: string): Promise<void> {
  await prisma.userLlmCredential.updateMany({
    where: { userId, provider: CHATGPT_PROVIDER },
    data: { status: 'needs_reauth' },
  });
}

// ── Status / settings / models ────────────────────────────────────────────────

export interface ChatGPTPlanStatus {
  enabled: boolean;
  mode: 'hosted' | 'open_source';
  connected: boolean;
  status?: string;
  accountEmail?: string | null;
  useForChat?: boolean;
  defaultModel?: string | null;
  welcomeAcknowledged?: boolean;
  lastUsageLimitAt?: string | null;
  manageUsageUrl: string;
  helpUrl: string;
}

export async function getStatus(userId: string): Promise<ChatGPTPlanStatus> {
  const base = {
    enabled: isChatGPTPlanEnabled(),
    mode: chatgptMode(),
    manageUsageUrl: CHATGPT_MANAGE_USAGE_URL,
    helpUrl: CHATGPT_HELP_URL,
  };
  const cred = await prisma.userLlmCredential.findUnique({
    where: { userId_provider: { userId, provider: CHATGPT_PROVIDER } },
  });
  if (!cred) return { ...base, connected: false };
  return {
    ...base,
    connected: true,
    status: cred.status,
    accountEmail: cred.accountEmail,
    useForChat: cred.useForChat,
    defaultModel: cred.defaultModel,
    welcomeAcknowledged: cred.welcomeAcknowledgedAt != null,
    lastUsageLimitAt: cred.lastUsageLimitAt?.toISOString() ?? null,
  };
}

export async function updateSettings(
  userId: string,
  patch: { useForChat?: boolean; defaultModel?: string | null; acknowledgeWelcome?: boolean },
): Promise<void> {
  const res = await prisma.userLlmCredential.updateMany({
    where: { userId, provider: CHATGPT_PROVIDER },
    data: {
      ...(patch.useForChat !== undefined ? { useForChat: patch.useForChat } : {}),
      ...(patch.defaultModel !== undefined ? { defaultModel: patch.defaultModel } : {}),
      ...(patch.acknowledgeWelcome ? { welcomeAcknowledgedAt: new Date() } : {}),
    },
  });
  if (res.count === 0) throw new ChatGPTAuthError('not_connected', 'ChatGPT plan is not connected');
}

export async function recordUsageLimit(userId: string): Promise<void> {
  await prisma.userLlmCredential
    .updateMany({
      where: { userId, provider: CHATGPT_PROVIDER },
      data: { lastUsageLimitAt: new Date() },
    })
    .catch((err) => logger.warn({ err }, 'Failed to record ChatGPT usage limit'));
}

/**
 * Disconnect: revoke the refresh token at OpenAI's RFC 7009 revocation
 * endpoint (advertised in OIDC discovery; best-effort — the per-flow docs don't
 * cover it yet), then delete Hearth's copy. Users can also remove Hearth in
 * ChatGPT → Settings → Security and login → Sign in with ChatGPT.
 */
export async function disconnect(userId: string): Promise<void> {
  const cred = await prisma.userLlmCredential.findUnique({
    where: { userId_provider: { userId, provider: CHATGPT_PROVIDER } },
  });
  if (cred?.encryptedRefreshToken) {
    try {
      const res = await fetch(authUrl('/api/accounts/oauth/revoke'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: decrypt(cred.encryptedRefreshToken),
          token_type_hint: 'refresh_token',
          client_id: cred.clientId,
        }),
      });
      if (!res.ok) logger.warn({ status: res.status }, 'ChatGPT token revocation returned non-OK');
    } catch (err) {
      logger.warn({ err }, 'ChatGPT token revocation failed; deleting local tokens anyway');
    }
  }
  await prisma.userLlmCredential.deleteMany({ where: { userId, provider: CHATGPT_PROVIDER } });
}

export interface PlanModel {
  id: string;
  displayName: string;
}

/** Models available to the connected account (`visibility === 'list'`). */
export async function listPlanModels(userId: string): Promise<PlanModel[]> {
  const token = await getAccessToken(userId);
  const res = await fetch(`${env.CHATGPT_API_BASE_URL.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    await markNeedsReauth(userId);
    throw new ChatGPTAuthError('needs_reauth', 'Reconnect your ChatGPT account');
  }
  if (!res.ok) throw new Error(`ChatGPT model listing failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    models?: Array<{ slug?: string; display_name?: string; visibility?: string }>;
  };
  return (json.models ?? [])
    .filter((m) => m.visibility === 'list' && m.slug)
    .map((m) => ({ id: m.slug!, displayName: m.display_name ?? m.slug! }));
}

/** Whether the user should have their chats routed through their ChatGPT plan. */
export async function resolveChatRouting(
  userId: string,
): Promise<{ useChatGPTPlan: boolean; defaultModel: string | null }> {
  if (!isChatGPTPlanEnabled()) return { useChatGPTPlan: false, defaultModel: null };
  const cred = await prisma.userLlmCredential.findUnique({
    where: { userId_provider: { userId, provider: CHATGPT_PROVIDER } },
    select: { useForChat: true, status: true, defaultModel: true },
  });
  if (!cred || !cred.useForChat) return { useChatGPTPlan: false, defaultModel: null };
  // needs_reauth still routes here so the user gets an actionable error rather
  // than silently switching to the org's key.
  return { useChatGPTPlan: true, defaultModel: cred.defaultModel };
}
