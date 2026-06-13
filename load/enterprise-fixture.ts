/**
 * Enterprise fixture — expands the existing `hearth-sim` org into a realistic
 * ~500-person REGULATED tech company for end-to-end simulation:
 *   - 14 departments (incl. Security & Compliance, Legal, Finance) as teams
 *   - a named leadership + compliance/security cast (the scenario protagonists)
 *   - bulk headcount across departments with a seniority→role distribution
 *
 * Idempotent: skips departments/users that already exist (matched by name/email),
 * so it layers cleanly on top of the current org without disturbing the named
 * protagonists (Marcus Chen, Devin Rao, Priya Sharma, …) created earlier.
 *
 * Run:  ./apps/api/node_modules/.bin/tsx load/enterprise-fixture.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();
faker.seed(20260612);

const DEPARTMENTS = [
  'Engineering', 'Product', 'Design', 'Data & Analytics', 'Security & Compliance',
  'Legal', 'Finance', 'Sales', 'Marketing', 'Customer Support', 'IT', 'People', 'Ops', 'Exec',
];

// Named protagonists to ADD (existing ones like cto@/eng-lead@ are left as-is).
// role = Hearth RBAC role (admin | team_lead | member | viewer).
const LEADERS: Array<{ email: string; name: string; role: string; dept: string }> = [
  // C-suite / org admins
  { email: 'ceo@hearth.local', name: 'Helena Voss', role: 'admin', dept: 'Exec' },
  { email: 'cfo@hearth.local', name: 'Raj Mehta', role: 'admin', dept: 'Finance' },
  // Security & Compliance — the governance/policy protagonists
  { email: 'ciso@hearth.local', name: 'Tara Osei', role: 'admin', dept: 'Security & Compliance' },
  { email: 'compliance@hearth.local', name: 'Lena Fischer', role: 'admin', dept: 'Security & Compliance' },
  { email: 'security-analyst@hearth.local', name: 'Mei Lin', role: 'member', dept: 'Security & Compliance' },
  // IT / provisioning admin
  { email: 'it-admin@hearth.local', name: 'Paul Nguyen', role: 'admin', dept: 'IT' },
  // Department heads (team leads)
  { email: 'vp-eng@hearth.local', name: 'Sofia Reyes', role: 'team_lead', dept: 'Engineering' },
  { email: 'data-lead@hearth.local', name: 'Yuki Tanaka', role: 'team_lead', dept: 'Data & Analytics' },
  { email: 'legal-lead@hearth.local', name: 'Victor Hale', role: 'team_lead', dept: 'Legal' },
  { email: 'sales-lead@hearth.local', name: 'Greg Mason', role: 'team_lead', dept: 'Sales' },
  { email: 'marketing-lead@hearth.local', name: 'Bianca Rossi', role: 'team_lead', dept: 'Marketing' },
  { email: 'support-lead@hearth.local', name: 'Aisha Bello', role: 'team_lead', dept: 'Customer Support' },
  { email: 'hr-lead@hearth.local', name: 'Carlos Diaz', role: 'team_lead', dept: 'People' },
  { email: 'finance-lead@hearth.local', name: 'Nadia Petrov', role: 'team_lead', dept: 'Finance' },
  // A handful of ICs who routinely touch regulated data (for violation scenarios)
  { email: 'sales-rep@hearth.local', name: 'Tom Becker', role: 'member', dept: 'Sales' },
  { email: 'support-agent@hearth.local', name: 'Grace Kim', role: 'member', dept: 'Customer Support' },
  { email: 'finance-analyst@hearth.local', name: 'Ines Moreau', role: 'member', dept: 'Finance' },
  { email: 'legal-counsel@hearth.local', name: 'Derek Shaw', role: 'member', dept: 'Legal' },
  { email: 'data-scientist@hearth.local', name: 'Hassan Ali', role: 'member', dept: 'Data & Analytics' },
];

// Headcount to add per department (bulk ICs) — ~ totals a 500-person org.
const HEADCOUNT: Record<string, number> = {
  Engineering: 120, Product: 35, Design: 25, 'Data & Analytics': 30,
  'Security & Compliance': 12, Legal: 10, Finance: 20, Sales: 70,
  Marketing: 30, 'Customer Support': 60, IT: 20, People: 18, Ops: 25, Exec: 5,
};

async function main(): Promise<void> {
  const org = await prisma.org.findUnique({ where: { slug: 'hearth-sim' } });
  if (!org) throw new Error('hearth-sim org not found — run sim-seed first');
  const hash = await bcrypt.hash('changeme', 10);

  // 1. Ensure department teams exist.
  const teamByDept = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    let team = await prisma.team.findFirst({ where: { orgId: org.id, name: dept } });
    if (!team) team = await prisma.team.create({ data: { name: dept, orgId: org.id } });
    teamByDept.set(dept, team.id);
  }
  console.log(`Departments ready: ${DEPARTMENTS.length}`);

  // 2. Named leadership / compliance cast (idempotent by email).
  let leadersAdded = 0;
  for (const l of LEADERS) {
    const existing = await prisma.user.findUnique({ where: { email: l.email } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        email: l.email, name: l.name, role: l.role as never,
        authProvider: 'email', passwordHash: hash, teamId: teamByDept.get(l.dept)!,
      },
    });
    leadersAdded++;
  }
  console.log(`Named leaders added: ${leadersAdded} (skipped ${LEADERS.length - leadersAdded} existing)`);

  // 3. Bulk headcount per department. ~12% viewers (contractors/interns),
  //    ~8% team_leads (managers), rest members. Emails: ic_<dept>_<n>@hearth-ent.local.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '');
  const rows: Array<{ email: string; name: string; role: string; teamId: string }> = [];
  for (const [dept, n] of Object.entries(HEADCOUNT)) {
    const teamId = teamByDept.get(dept)!;
    for (let i = 0; i < n; i++) {
      const r = faker.number.float();
      const role = r < 0.12 ? 'viewer' : r < 0.20 ? 'team_lead' : 'member';
      rows.push({
        email: `ic_${slug(dept)}_${i}@hearth-ent.local`,
        name: faker.person.fullName(),
        role,
        teamId,
      });
    }
  }
  // Skip any that already exist (re-runs), then bulk insert.
  const existingEmails = new Set(
    (await prisma.user.findMany({ where: { email: { in: rows.map((r) => r.email) } }, select: { email: true } })).map((u) => u.email),
  );
  const toCreate = rows.filter((r) => !existingEmails.has(r.email));
  if (toCreate.length > 0) {
    await prisma.user.createMany({
      data: toCreate.map((r) => ({
        email: r.email, name: r.name, role: r.role as never,
        authProvider: 'email', passwordHash: hash, teamId: r.teamId,
      })),
    });
  }
  console.log(`Bulk ICs added: ${toCreate.length} (skipped ${rows.length - toCreate.length} existing)`);

  const total = await prisma.user.count({ where: { team: { orgId: org.id } } });
  console.log(`\nhearth-sim total headcount: ${total}`);
}

main()
  .catch((e) => { console.error('enterprise-fixture failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
