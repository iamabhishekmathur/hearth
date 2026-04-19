import { Router, type Router as RouterType } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { decisionExtractionQueue } from '../jobs/decision-extraction-scheduler.js';

const router: RouterType = Router();
router.use(requireAuth);

async function getOrgId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });
  const org = user?.team?.orgId
    ? { id: user.team.orgId }
    : await prisma.org.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return org?.id ?? '';
}

// Ingest meeting notes
router.post('/ingest', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { title, transcript, summary, participants, meetingDate, provider, externalMeetingId, calendarEventId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const meeting = await prisma.meetingIngestion.create({
      data: {
        orgId,
        provider: provider ?? 'manual',
        externalMeetingId,
        title,
        participants: participants ?? [],
        meetingDate: meetingDate ? new Date(meetingDate) : new Date(),
        transcript,
        summary,
        calendarEventId,
      },
    });

    // Enqueue for decision extraction if transcript provided
    if (transcript) {
      await decisionExtractionQueue.add('meeting_ingestion', {
        meetingId: meeting.id,
      });
    }

    res.status(201).json({ data: meeting });
  } catch (err) {
    res.status(500).json({ error: 'Failed to ingest meeting' });
  }
});

// List meetings
router.get('/', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const meetings = await prisma.meetingIngestion.findMany({
      where: { orgId },
      orderBy: { meetingDate: 'desc' },
      take: limit,
    });
    res.json({ data: meetings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list meetings' });
  }
});

// Get meeting detail with decisions
router.get('/:id', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const meeting = await prisma.meetingIngestion.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    // Get decisions linked to this meeting
    const decisions = await prisma.decision.findMany({
      where: {
        orgId,
        source: 'meeting',
        sourceRef: { path: ['meetingId'], equals: meeting.id },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: { ...meeting, decisions } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get meeting' });
  }
});

export default router;
