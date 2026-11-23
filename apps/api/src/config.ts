import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Load .env from project root (two levels up from apps/api/)
dotenv.config({ path: path.resolve(import.meta.dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(8000),
  DATABASE_URL: z.string().default('postgresql://hearth:hearth@localhost:5432/hearth'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().default('dev-session-secret'),
  ENCRYPTION_KEY: z.string().default('0000000000000000000000000000000000000000000000000000000000000000'), // dev only; production guard below
  WEB_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:8000'),

  // LLM Providers (optional)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  // Agent-loop modernization (opencode adaptation; see plans/)
  // When true, the model catalog may refresh from models.dev in the background.
  // Left false/unset for self-host/air-gapped installs, which run entirely on
  // the committed snapshot (apps/api/src/llm/models.snapshot.json).
  HEARTH_MODEL_CATALOG_REFRESH: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Deprecation-window kill-switch (W1): re-registers the legacy hand-rolled
  // providers for one release while the AI SDK provider path is validated.
  HEARTH_LEGACY_PROVIDERS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),

  // Google OAuth (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .default('http://localhost:8000/api/v1/auth/oauth/google/callback'),

  // Web search (optional)
  BRAVE_SEARCH_API_KEY: z.string().optional(),

  // Slack (optional)
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // SMTP / Email (optional)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Hearth <noreply@hearth.local>'),

  // Dev-only: when set in non-production, attachUser auto-attaches the user
  // with this email so you can skip the login form. Ignored when NODE_ENV=production.
  DEV_AUTO_LOGIN: z.string().email().optional(),

  // SSO: `POST /auth/sso/callback` trusts the identity in its body, so it must
  // only be reachable from an upstream component that has already verified the
  // SAML assertion / OIDC token. That component proves itself with this shared
  // secret (header `x-hearth-sso-secret`). Unset ⇒ the callback is disabled.
  SSO_CALLBACK_SECRET: z.string().min(32).optional(),

  // Sign in with ChatGPT — per-user ChatGPT plan usage (see services/chatgpt-auth/).
  // Off unless explicitly enabled.
  CHATGPT_PLAN_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Statically-issued client id (hosted/commercial partners approved by OpenAI).
  // Unset ⇒ open-source dynamic registration (`dynamic_agent_client`).
  CHATGPT_CLIENT_ID: z.string().optional(),
  // OAuth redirect URI. The open-source flow only accepts a 127.0.0.1 loopback
  // URI, so the default points at the local API. Hosted deployments override
  // this with the URI registered for their approved client.
  CHATGPT_REDIRECT_URI: z.string().url().optional(),
  CHATGPT_AUTH_BASE_URL: z.string().url().default('https://auth.openai.com'),
  CHATGPT_API_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
});

const DEFAULT_ENCRYPTION_KEY = '0'.repeat(64);
const DEFAULT_SESSION_SECRET = 'dev-session-secret';

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  const problems = productionSecretProblems(result.data);
  if (problems.length > 0) {
    console.error('Refusing to start in production with insecure secrets:', problems);
    process.exit(1);
  }
  return result.data;
}

/**
 * In production, the dev defaults for ENCRYPTION_KEY / SESSION_SECRET would make
 * every encrypted integration/LLM token decryptable and sessions forgeable.
 * Exported for tests.
 */
export function productionSecretProblems(e: Pick<Env, 'NODE_ENV' | 'ENCRYPTION_KEY' | 'SESSION_SECRET'>): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (!/^[0-9a-fA-F]{64}$/.test(e.ENCRYPTION_KEY)) {
    problems.push('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  } else if (e.ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY || /^0+$/.test(e.ENCRYPTION_KEY)) {
    problems.push('ENCRYPTION_KEY is the all-zero development default');
  }
  if (e.SESSION_SECRET === DEFAULT_SESSION_SECRET || e.SESSION_SECRET.length < 32) {
    problems.push('SESSION_SECRET is the development default or shorter than 32 characters');
  }
  return problems;
}

export const env = loadEnv();
