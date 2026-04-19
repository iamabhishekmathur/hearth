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

  // Seed default Soul & Identity documents
  const orgSoulContent = `# Organization SOUL.md

You are Hearth, an AI productivity assistant embedded in our team workspace.

## Personality & Tone
- Be direct and action-oriented — do things, don't just explain them
- Use a professional but approachable tone
- Keep responses concise — lead with the answer, not the reasoning
- Use markdown formatting when it helps readability

## Communication Norms
- When asked to do something, do it. Don't ask for permission or confirmation unless the action is irreversible
- If you need to make a reasonable assumption, state it briefly and proceed
- Surface results first, process second
- Use bullet points for lists, prose for explanations

## Standards
- Default to TypeScript for code examples
- Cite sources when referencing external information
- Respect data privacy — never share one user's context with another`;

  const userSoulContent = `# My SOUL.md

## How I want you to communicate
- Be direct and concise — skip preamble
- When I ask a question, give me the answer first, then context if needed
- Use code blocks for any code snippets
- Don't over-explain things I likely already know`;

  const userIdentityContent = `# My IDENTITY.md

## About me
- I'm setting up Hearth for my team
- I'm interested in productivity tooling and AI workflows

## Preferences
- I prefer seeing working examples over theoretical explanations
- When creating artifacts, default to clean, well-structured content`;

  // Org SOUL.md
  const existingOrgSoul = await prisma.agentIdentity.findFirst({
    where: { orgId: org.id, userId: null, fileType: 'soul' },
  });
  if (!existingOrgSoul) {
    await prisma.agentIdentity.create({
      data: {
        orgId: org.id,
        userId: null,
        fileType: 'soul',
        content: orgSoulContent,
        source: 'template',
      },
    });
    console.log('Identity: Org SOUL.md (created)');
  } else {
    console.log('Identity: Org SOUL.md (already exists)');
  }

  // User SOUL.md
  const existingUserSoul = await prisma.agentIdentity.findFirst({
    where: { orgId: org.id, userId: admin.id, fileType: 'soul' },
  });
  if (!existingUserSoul) {
    await prisma.agentIdentity.create({
      data: {
        orgId: org.id,
        userId: admin.id,
        fileType: 'soul',
        content: userSoulContent,
        source: 'template',
      },
    });
    console.log('Identity: User SOUL.md (created)');
  } else {
    console.log('Identity: User SOUL.md (already exists)');
  }

  // User IDENTITY.md
  const existingUserIdentity = await prisma.agentIdentity.findFirst({
    where: { orgId: org.id, userId: admin.id, fileType: 'identity' },
  });
  if (!existingUserIdentity) {
    await prisma.agentIdentity.create({
      data: {
        orgId: org.id,
        userId: admin.id,
        fileType: 'identity',
        content: userIdentityContent,
        source: 'template',
      },
    });
    console.log('Identity: User IDENTITY.md (created)');
  } else {
    console.log('Identity: User IDENTITY.md (already exists)');
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
