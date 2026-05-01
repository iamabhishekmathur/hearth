-- T2: AI ↔ prompt linkage
ALTER TABLE "chat_messages"
  ADD COLUMN "responding_to_message_id" TEXT;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_responding_to_message_id_fkey"
  FOREIGN KEY ("responding_to_message_id") REFERENCES "chat_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "chat_messages_responding_to_message_id_idx"
  ON "chat_messages"("responding_to_message_id");
