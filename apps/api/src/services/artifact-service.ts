import type { ArtifactType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

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

  const current = await prisma.artifact.findUnique({
    where: { id: artifactId },
  });

  if (!current) return null;

  const nextVersion = current.version + 1;
  const updatedTitle = title ?? current.title;
  const updatedContent = content ?? current.content;

  return prisma.$transaction(async (tx) => {
    const artifact = await tx.artifact.update({
      where: { id: artifactId },
      data: {
        title: updatedTitle,
        content: updatedContent,
        language: language !== undefined ? language : current.language,
        version: nextVersion,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

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

    return artifact;
  });
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
