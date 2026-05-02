import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { requireAuth, requireOrg } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { tenantUploadDir } from '../lib/storage-paths.js';

const router: ReturnType<typeof Router> = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_PATTERNS = [
  /^image\//,
  /^application\/pdf$/,
  /^text\//,
  /^application\/json$/,
];

function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
}

const UPLOADS_ROOT = path.resolve('uploads');

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    // requireOrg middleware guarantees orgId is non-null by the time
    // multer's destination callback runs.
    const orgId = (req as { user?: { orgId?: string | null } }).user?.orgId;
    if (!orgId) {
      return cb(new Error('Upload destination requires an authenticated org context'), '');
    }
    const dir = path.join(UPLOADS_ROOT, tenantUploadDir(orgId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const uuid = crypto.randomUUID();
    // Sanitize original filename: remove path separators, limit length
    const safeName = file.originalname.replace(/[/\\]/g, '_').slice(-100);
    cb(null, `${uuid}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (!isAllowedMime(file.mimetype)) {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /uploads — upload a file
 * Creates a ChatAttachment record with no message link (messageId = null).
 * The attachment is linked when the chat message is sent with attachmentIds.
 */
router.post('/', requireAuth, requireOrg, upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    // Store the relative path from the uploads root: e.g. "2026-04/uuid-filename"
    const relativePath = path.relative(UPLOADS_ROOT, file.path);

    const attachment = await prisma.chatAttachment.create({
      data: {
        // requireOrg guarantees orgId is non-null
        orgId: req.user!.orgId!,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: relativePath,
      },
    });

    res.status(201).json({
      data: {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        url: `/api/v1/uploads/${relativePath}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /uploads/:filePath(*) — serve uploaded files
 *
 * The path layout is `org/{orgId}/{yyyy-mm}/{uuid}-{filename}`. Access is
 * granted only when the requesting user belongs to the org encoded in the
 * path. Legacy paths that predate the per-tenant layout (no `org/` prefix)
 * are served only to authenticated users without further checks — they
 * existed before tenant isolation and exist only on existing deployments.
 */
router.get('/:filePath(*)', requireAuth, (req, res, next) => {
  try {
    const filePath = String(req.params.filePath);
    const fullPath = path.resolve(UPLOADS_ROOT, filePath);

    // Prevent directory traversal
    if (!fullPath.startsWith(UPLOADS_ROOT + path.sep) && fullPath !== UPLOADS_ROOT) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // If the path is under the per-tenant prefix, enforce that the requester
    // belongs to the same org. (Legacy paths without the prefix bypass this
    // check — see comment above.)
    const tenantPrefixMatch = filePath.match(/^org\/([^/]+)\//);
    if (tenantPrefixMatch) {
      const pathOrgId = tenantPrefixMatch[1];
      if (req.user?.orgId !== pathOrgId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.sendFile(fullPath);
  } catch (err) {
    next(err);
  }
});

export default router;
