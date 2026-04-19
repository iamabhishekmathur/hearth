import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { extractDecisionsFromTranscript } from './decision-extractor.js';
import { createDecision } from './decision-service.js';

/**
 * Process a meeting ingestion: extract decisions from transcript.
 */
export async function processMeetingIngestion(meetingId: string) {
  const meeting = await prisma.meetingIngestion.findUnique({ where: { id: meetingId } });
  if (!meeting || !meeting.transcript) {
    logger.warn({ meetingId }, 'Meeting not found or no transcript');
    return;
  }

  try {
    const extracted = await extractDecisionsFromTranscript(meeting.transcript);

    // Resolve participants to user IDs
    const userMap = new Map<string, string>();
    if (meeting.participants.length > 0) {
      const users = await prisma.user.findMany({
        where: {
          OR: meeting.participants.map((p: string) => ({
            OR: [
              { email: { contains: p, mode: 'insensitive' as const } },
              { name: { contains: p, mode: 'insensitive' as const } },
            ],
          })),
        },
        select: { id: true, name: true, email: true },
      });
      for (const u of users) {
        userMap.set(u.name.toLowerCase(), u.id);
        userMap.set(u.email.toLowerCase(), u.id);
      }
    }

    // Get an admin/system user to attribute the decisions to
    const orgUsers = await prisma.user.findMany({
      where: { team: { orgId: meeting.orgId } },
      select: { id: true, role: true, teamId: true },
      take: 1,
      orderBy: { createdAt: 'asc' },
    });
    const systemUser = orgUsers[0];
    if (!systemUser) {
      logger.warn({ meetingId }, 'No user found in org for meeting attribution');
      return;
    }

    let decisionsCreated = 0;

    for (const decision of extracted) {
      const participantIds = decision.stakeholders
        .map(s => userMap.get(s.toLowerCase()))
        .filter(Boolean) as string[];

      await createDecision(
        {
          orgId: meeting.orgId,
          userId: systemUser.id,
          teamId: systemUser.teamId,
          role: systemUser.role,
        },
        {
          title: decision.title,
          reasoning: decision.reasoning,
          alternatives: decision.alternatives,
          domain: decision.domain,
          tags: decision.relatedTopics,
          source: 'meeting',
          sourceRef: { meetingId: meeting.id, provider: meeting.provider },
          participants: participantIds,
          confidence: decision.confidence >= 0.8 ? 'high' : decision.confidence >= 0.5 ? 'medium' : 'low',
        },
      );
      decisionsCreated++;
    }

    await prisma.meetingIngestion.update({
      where: { id: meetingId },
      data: {
        processedAt: new Date(),
        decisionsExtracted: decisionsCreated,
      },
    });

    logger.info({ meetingId, decisionsCreated }, 'Meeting ingestion processed');
  } catch (err) {
    logger.error({ err, meetingId }, 'Meeting ingestion processing failed');
  }
}
