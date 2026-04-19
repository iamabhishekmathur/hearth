import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../mcp/token-store.js';
import { logger } from '../lib/logger.js';

export async function createWebhookEndpoint(orgId: string, data: {
  provider: string;
  integrationId?: string;
}) {
  const urlToken = randomBytes(24).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const encryptedSecret = encrypt(secret);

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      orgId,
      integrationId: data.integrationId ?? null,
      provider: data.provider,
      urlToken,
      secret: encryptedSecret,
      enabled: true,
    },
  });

  return { ...endpoint, plainSecret: secret };
}

export async function listWebhookEndpoints(orgId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    include: { triggers: { select: { id: true, routineId: true, eventType: true, status: true } } },
  });
}

export async function getWebhookEndpoint(id: string, orgId: string) {
  return prisma.webhookEndpoint.findFirst({
    where: { id, orgId },
    include: { triggers: true },
  });
}

export async function getWebhookEndpointByToken(urlToken: string) {
  return prisma.webhookEndpoint.findUnique({
    where: { urlToken },
    include: { triggers: { where: { status: 'active' } } },
  });
}

export async function deleteWebhookEndpoint(id: string, orgId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, orgId } });
  if (!endpoint) return null;

  // Delete associated triggers first
  await prisma.routineTrigger.deleteMany({ where: { webhookEndpointId: id } });
  return prisma.webhookEndpoint.delete({ where: { id } });
}

export async function toggleWebhookEndpoint(id: string, orgId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, orgId } });
  if (!endpoint) return null;

  return prisma.webhookEndpoint.update({
    where: { id },
    data: { enabled: !endpoint.enabled },
  });
}
