/**
 * Per-tenant storage path helpers.
 *
 * Every uploaded file (chat attachments, task context items) lives under
 * a tenant-scoped prefix. Locally this is `uploads/org/{orgId}/...`; in
 * cloud (Phase 6) it becomes the S3 key prefix `org/{orgId}/...` enforced
 * by an IAM bucket policy.
 *
 * The on-disk layout is:
 *   uploads/
 *     org/{orgId}/
 *       {yyyy-mm}/
 *         {uuid}-{filename}
 *
 * Storing the org-scoped prefix in storage_path (the column on
 * chat_attachments and task_context_items) means the path itself
 * encodes which tenant owns the file. A path leak through file serving
 * is still possible without auth checks, but the prefix at minimum
 * lets infra enforcement (S3 bucket policy) reject cross-tenant reads.
 */
export function tenantUploadPrefix(orgId: string): string {
  if (!orgId) {
    throw new Error('tenantUploadPrefix() requires a non-empty orgId');
  }
  return `org/${orgId}`;
}

/**
 * The current month subdirectory (YYYY-MM). Files are bucketed by month
 * to keep directory listings small.
 */
export function currentMonthDir(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Build the full relative storage path for a new upload.
 *   tenantUploadDir('org-123') → 'org/org-123/2026-05'
 */
export function tenantUploadDir(orgId: string, now: Date = new Date()): string {
  return `${tenantUploadPrefix(orgId)}/${currentMonthDir(now)}`;
}
