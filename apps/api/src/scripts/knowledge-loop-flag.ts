/**
 * Knowledge loop, Phase 2 — turn the `knowledgeLoop` org flag on or off.
 *
 * The flag gates the nightly curator and the Review inbox. It is off by
 * default; there is no admin screen for it yet.
 *
 *   pnpm --filter @hearth/api knowledge:flag -- --org <orgId> --on
 *   pnpm --filter @hearth/api knowledge:flag -- --org <orgId> --off
 *
 * Only `settings.features.knowledgeLoop` changes; every other setting stays.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  const on = process.argv.includes('--on');
  const off = process.argv.includes('--off');
  if (!orgId || on === off) {
    console.error('Usage: knowledge:flag -- --org <orgId> (--on | --off)');
    process.exit(1);
  }
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  if (!org) {
    console.error(`No org with id ${orgId}`);
    process.exit(1);
  }
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const features = (settings.features ?? {}) as Record<string, unknown>;
  await prisma.org.update({
    where: { id: orgId },
    data: {
      settings: {
        ...settings,
        features: { ...features, knowledgeLoop: on },
      } as Prisma.InputJsonValue,
    },
  });
  console.log(`knowledgeLoop is now ${on ? 'ON' : 'OFF'} for org ${orgId}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
