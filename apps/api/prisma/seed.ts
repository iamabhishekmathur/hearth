import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default org
  const org = await prisma.org.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: 'Default Organization',
      slug: 'default',
      settings: {},
    },
  });
  console.log(`Org: ${org.name} (${org.id})`);

  // Create default team
  const team = await prisma.team.upsert({
    where: { id: org.id }, // use org id as a stable lookup; fallback to create
    update: {},
    create: {
      name: 'Default Team',
      orgId: org.id,
    },
  });
  console.log(`Team: ${team.name} (${team.id})`);

  // Create admin user
  const passwordHash = await bcrypt.hash('changeme', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@hearth.local' },
    update: {},
    create: {
      email: 'admin@hearth.local',
      name: 'Admin',
      role: 'admin',
      authProvider: 'email',
      passwordHash,
      teamId: team.id,
      preferences: {},
    },
  });
  console.log(`Admin user: ${admin.email} (${admin.id})`);

  // Seed sample integrations for visibility
  const sampleIntegrations = [
    { provider: 'slack', config: { encryptedCredentials: 'sample', label: 'Slack' } },
    { provider: 'notion', config: { encryptedCredentials: 'sample', label: 'Notion' } },
    { provider: 'gcalendar', config: { encryptedCredentials: 'sample', label: 'Google Calendar' } },
    { provider: 'gmail', config: { encryptedCredentials: 'sample', label: 'Gmail' } },
  ];

  for (const integ of sampleIntegrations) {
    const existing = await prisma.integration.findFirst({
      where: { orgId: org.id, provider: integ.provider },
    });
    if (!existing) {
      await prisma.integration.create({
        data: {
          orgId: org.id,
          provider: integ.provider,
          config: integ.config,
          status: 'active',
          enabled: true,
        },
      });
      console.log(`Integration: ${integ.provider}`);
    } else {
      console.log(`Integration: ${integ.provider} (already exists)`);
    }
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
