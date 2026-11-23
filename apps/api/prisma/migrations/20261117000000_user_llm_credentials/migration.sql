-- ──────────────────────────────────────────────────────────────────────────
-- Sign in with ChatGPT: per-user LLM credentials ("Use your ChatGPT plan").
--
-- One row per (user, provider). OAuth access/refresh tokens are stored
-- AES-256-GCM encrypted (mcp/token-store.ts). Org-scoped for RLS.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "user_llm_credentials" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "account_subject" TEXT NOT NULL,
  "account_email" TEXT,
  "client_id" TEXT NOT NULL,
  "encrypted_access_token" TEXT NOT NULL,
  "encrypted_refresh_token" TEXT,
  "access_token_expires_at" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "use_for_chat" BOOLEAN NOT NULL DEFAULT true,
  "default_model" TEXT,
  "welcome_acknowledged_at" TIMESTAMP(3),
  "last_usage_limit_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_llm_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_llm_credentials_user_id_provider_key"
  ON "user_llm_credentials" ("user_id", "provider");
CREATE INDEX "user_llm_credentials_org_id_idx" ON "user_llm_credentials" ("org_id");

ALTER TABLE "user_llm_credentials"
  ADD CONSTRAINT "user_llm_credentials_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_llm_credentials"
  ADD CONSTRAINT "user_llm_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- org-scoped table (see 20260501000001_enable_rls).
ALTER TABLE "user_llm_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_llm_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_llm_credentials_tenant_isolation" ON "user_llm_credentials"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));
