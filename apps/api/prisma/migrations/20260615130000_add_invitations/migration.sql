-- ──────────────────────────────────────────────────────────────────────────
-- Invitations (growth loop).
--
-- A pending invite to join an org. The unguessable `token` is the secret used
-- by the two PUBLIC endpoints (preview + accept) that run before any session
-- exists.
--
-- RLS: this table is intentionally NOT enrolled in Row-Level Security. The
-- public token lookup runs with no tenant context (no session yet), so an RLS
-- policy keyed on app.org_id would return zero rows and break acceptance.
-- Access is gated by the token (public flows) or an explicit org_id filter in
-- invitation-service (authed flows). Do NOT add `invitations` to the RLS
-- table list.
--
-- Idempotent re-invite: a PARTIAL unique index guarantees at most one PENDING
-- invite per (org_id, email). Accepted/revoked/expired rows stay in history and
-- don't block a fresh invite.
-- ──────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "InvitationContextType" AS ENUM ('decision', 'chat_session', 'task');

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "context_type" "InvitationContextType",
    "context_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "accepted_user_id" TEXT,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_org_id_idx" ON "invitations"("org_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- One PENDING invite per (org, email). Partial so historical
-- accepted/revoked/expired rows don't conflict with a fresh re-invite.
CREATE UNIQUE INDEX "invitations_org_email_pending_key"
  ON "invitations"("org_id", "email")
  WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_invited_by_user_id_fkey"
  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_accepted_user_id_fkey"
  FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
