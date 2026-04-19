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
  ENCRYPTION_KEY: z.string().default('0000000000000000000000000000000000000000000000000000000000000000'),
  WEB_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:8000'),

  // LLM Providers (optional)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

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
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
