import type { ArtifactType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isUniqueViolation } from '../lib/prisma-errors.js';

/**
 * Creates a new artifact in a session, saving the v1 snapshot atomically.
 */
export async function createArtifact(params: {
  sessionId: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  createdBy: string;
  parentMessageId?: string;
}) {
  const { sessionId, type, title, content, language, createdBy, parentMessageId } = params;

  return prisma.$transaction(async (tx) => {
    // Resolve the session's org so the artifact (and its v1 snapshot) inherit it.
    const session = await tx.chatSession.findUnique({
      where: { id: sessionId },
      select: { orgId: true },
    });
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const artifact = await tx.artifact.create({
      data: {
        orgId: session.orgId,
        sessionId,
        type,
        title,
        content,
        language: language ?? null,
        version: 1,
        createdBy,
        parentMessageId: parentMessageId ?? null,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    await tx.artifactVersion.create({
      data: {
        orgId: session.orgId,
        artifactId: artifact.id,
        version: 1,
        title,
        content,
        editedBy: createdBy,
      },
    });

    return artifact;
  });
}

/**
 * Updates an artifact's content, bumps version, and saves a snapshot.
 */
export async function updateArtifact(params: {
  artifactId: string;
  title?: string;
  content?: string;
  language?: string;
  editedBy: string;
}) {
  const { artifactId, title, content, language, editedBy } = params;

  // Optimistic concurrency: read the current version, then bump it with a
  // compare-and-set (update WHERE id AND version=current). If a concurrent
  // writer already bumped it, our CAS matches 0 rows — we re-read and retry, so
  // each successful update increments by exactly 1 and writes exactly one
  // matching version row. Without this, two readers both saw v1 → both wrote v2
  // (a lost update + a duplicate version row / desynced count).
  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await prisma.artifact.findUnique({ where: { id: artifactId } });
    if (!current) return null;

    const nextVersion = current.version + 1;
    const updatedTitle = title ?? current.title;
    const updatedContent = content ?? current.content;
    const updatedLanguage = language !== undefined ? language : current.language;

    try {
      const artifact = await prisma.$transaction(async (tx) => {
        // CAS guard: only succeeds if no one else bumped the version meanwhile.
        const cas = await tx.artifact.updateMany({
          where: { id: artifactId, version: current.version },
          data: {
            title: updatedTitle,
            content: updatedContent,
            language: updatedLanguage,
            version: nextVersion,
          },
        });
        if (cas.count === 0) return null; // lost the race — retry from a fresh read

        await tx.artifactVersion.create({
          data: {
            orgId: current.orgId,
            artifactId,
            version: nextVersion,
            title: updatedTitle,
            content: updatedContent,
            editedBy,
          },
        });

        return tx.artifact.findUnique({
          where: { id: artifactId },
          include: { author: { select: { id: true, name: true } } },
        });
      });

      if (artifact) return artifact;
      // else: CAS conflict → loop and retry with the new current version
    } catch (err) {
      // A unique (artifactId, version) collision means a concurrent writer took
      // our target version — retry rather than surfacing a 500.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }

  throw new Error('Artifact update failed after repeated concurrent-write conflicts');
}

/**
 * Lists all artifacts for a session, ordered by most recent first.
 */
export async function listArtifacts(sessionId: string) {
  return prisma.artifact.findMany({
    where: { sessionId },
    include: {
      author: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Gets a single artifact by ID, including the author name.
 */
export async function getArtifact(artifactId: string) {
  return prisma.artifact.findUnique({
    where: { id: artifactId },
    include: {
      author: { select: { id: true, name: true } },
    },
  });
}

/**
 * Gets the version history for an artifact, ordered by most recent first.
 */
export async function getArtifactVersions(artifactId: string) {
  return prisma.artifactVersion.findMany({
    where: { artifactId },
    include: {
      editor: { select: { id: true, name: true } },
    },
    orderBy: { version: 'desc' },
  });
}

/**
 * Deletes an artifact and all its versions atomically.
 */
export async function deleteArtifact(artifactId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.artifactVersion.deleteMany({
      where: { artifactId },
    });

    return tx.artifact.delete({
      where: { id: artifactId },
    });
  });
}
