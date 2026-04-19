-- CreateEnum
CREATE TYPE "TaskContextItemType" AS ENUM ('note', 'link', 'file', 'image', 'text_block', 'mcp_reference');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "task_context_items" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" "TaskContextItemType" NOT NULL,
    "label" TEXT,
    "raw_value" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "storage_path" TEXT,
    "extracted_text" TEXT,
    "extracted_title" TEXT,
    "extraction_status" "ExtractionStatus" NOT NULL DEFAULT 'pending',
    "extraction_error" TEXT,
    "mcp_integration_id" TEXT,
    "mcp_resource_type" TEXT,
    "mcp_resource_id" TEXT,
    "vision_analysis" TEXT,
    "embedding" vector,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_context_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_context_items_task_id_sort_order_idx" ON "task_context_items"("task_id", "sort_order");

-- AddForeignKey
ALTER TABLE "task_context_items" ADD CONSTRAINT "task_context_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_context_items" ADD CONSTRAINT "task_context_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
