import { defineConfig } from 'vitepress';

const startSidebar = [
  {
    text: 'Start here',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/' },
      { text: 'Choose Your Path', link: '/getting-started/' },
      { text: 'Start with Hearth Cloud', link: '/getting-started/cloud' },
      { text: 'Start Self-Hosted', link: '/getting-started/self-hosted' },
      { text: 'Cloud vs Self-Hosted', link: '/getting-started/comparison' },
    ],
  },
  {
    text: 'Next steps',
    collapsed: false,
    items: [
      { text: 'Product Guide', link: '/guide/' },
      { text: 'Admin Guide', link: '/admin/' },
      { text: 'Hearth Cloud', link: '/cloud/' },
      { text: 'Self-Hosting', link: '/self-hosting/' },
    ],
  },
];

const guideSidebar = [
  {
    text: 'Product guide',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/guide/' },
      { text: 'Chat', link: '/guide/chat' },
      { text: 'Artifacts', link: '/guide/artifacts' },
      { text: 'Tasks', link: '/guide/tasks' },
      { text: 'Memory', link: '/guide/memory' },
      { text: 'Routines', link: '/guide/routines' },
      { text: 'Skills', link: '/guide/skills' },
      { text: 'Activity Feed', link: '/guide/activity' },
      { text: 'Decision Graph', link: '/guide/decisions' },
    ],
  },
  {
    text: 'Setup',
    collapsed: true,
    items: [
      { text: 'Start with Hearth Cloud', link: '/getting-started/cloud' },
      { text: 'Start Self-Hosted', link: '/getting-started/self-hosted' },
      { text: 'Cloud vs Self-Hosted', link: '/getting-started/comparison' },
    ],
  },
];

const adminSidebar = [
  {
    text: 'Admin guide',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/admin/' },
      { text: 'Users and Teams', link: '/admin/users-and-teams' },
      { text: 'Integrations', link: '/admin/integrations' },
      { text: 'LLM Providers', link: '/admin/llm-providers' },
      { text: 'Soul and Identity', link: '/admin/soul-and-identity' },
      { text: 'SSO', link: '/admin/sso' },
      { text: 'Skill Governance', link: '/admin/skill-governance' },
      { text: 'Governance', link: '/admin/governance' },
      { text: 'Compliance', link: '/admin/compliance' },
      { text: 'Audit Logs', link: '/admin/audit-logs' },
      { text: 'Analytics', link: '/admin/analytics' },
      { text: 'Cognitive Profiles', link: '/admin/cognitive-profiles' },
      { text: 'Decision Graph', link: '/admin/decision-graph' },
    ],
  },
  {
    text: 'Editions',
    collapsed: true,
    items: [
      { text: 'Cloud Admin Setup', link: '/cloud/workspace-setup' },
      { text: 'Self-Hosted Operations', link: '/self-hosting/' },
    ],
  },
];

const cloudSidebar = [
  {
    text: 'Hearth Cloud',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/cloud/' },
      { text: 'Workspace Setup', link: '/cloud/workspace-setup' },
      { text: 'Security and Data', link: '/cloud/security-and-data' },
      { text: 'Integrations', link: '/cloud/integrations' },
      { text: 'Limits and Billing', link: '/cloud/limits-and-billing' },
      { text: 'Support', link: '/cloud/support' },
    ],
  },
  {
    text: 'Shared product docs',
    collapsed: true,
    items: [
      { text: 'Product Guide', link: '/guide/' },
      { text: 'Admin Guide', link: '/admin/' },
      { text: 'Cloud vs Self-Hosted', link: '/getting-started/comparison' },
    ],
  },
];

const selfHostingSidebar = [
  {
    text: 'Self-hosting',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/self-hosting/' },
      { text: 'Docker Compose', link: '/self-hosting/docker' },
      { text: 'Kubernetes and Helm', link: '/self-hosting/kubernetes' },
      { text: 'Configuration', link: '/self-hosting/configuration' },
      { text: 'Secrets', link: '/self-hosting/secrets' },
      { text: 'Backups and Upgrades', link: '/self-hosting/backups-and-upgrades' },
      { text: 'Monitoring', link: '/self-hosting/monitoring' },
      { text: 'Troubleshooting', link: '/self-hosting/troubleshooting' },
    ],
  },
  {
    text: 'Shared product docs',
    collapsed: true,
    items: [
      { text: 'Product Guide', link: '/guide/' },
      { text: 'Admin Guide', link: '/admin/' },
      { text: 'Cloud vs Self-Hosted', link: '/getting-started/comparison' },
    ],
  },
];

const developerSidebar = [
  {
    text: 'Developers',
    collapsed: false,
    items: [
      { text: 'Developer Overview', link: '/developers/' },
      { text: 'API Reference', link: '/developers/api/' },
      { text: 'Chat and Sessions', link: '/developers/api/chat' },
      { text: 'Tasks', link: '/developers/api/tasks' },
      { text: 'Memory', link: '/developers/api/memory' },
      { text: 'Skills', link: '/developers/api/skills' },
      { text: 'Routines', link: '/developers/api/routines' },
      { text: 'Activity', link: '/developers/api/activity' },
      { text: 'Artifacts', link: '/developers/api/artifacts' },
      { text: 'Approvals', link: '/developers/api/approvals' },
      { text: 'Decisions', link: '/developers/api/decisions' },
      { text: 'Admin', link: '/developers/api/admin' },
      { text: 'Webhooks and Uploads', link: '/developers/api/webhooks' },
      { text: 'WebSocket Events', link: '/developers/websocket-events' },
    ],
  },
  {
    text: 'Architecture',
    collapsed: true,
    items: [
      { text: 'System Overview', link: '/developers/architecture/' },
      { text: 'Agent System', link: '/developers/architecture/agent' },
      { text: 'Database', link: '/developers/architecture/database' },
      { text: 'Services', link: '/developers/architecture/services' },
    ],
  },
  {
    text: 'Build and extend',
    collapsed: true,
    items: [
      { text: 'SKILL.md Format', link: '/developers/skill-format' },
      { text: 'Skill Examples', link: '/developers/skill-examples' },
      { text: 'MCP Overview', link: '/developers/connectors/' },
      { text: 'Building Connectors', link: '/developers/connectors/building' },
      { text: 'How to Contribute', link: '/developers/contributing/' },
      { text: 'Development Setup', link: '/developers/contributing/development' },
    ],
  },
];

export default defineConfig({
  title: 'Hearth Docs',
  description: 'Documentation for the Hearth AI productivity platform',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=JetBrains+Mono:wght@400;500;600&display=swap' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Start', link: '/getting-started/' },
      { text: 'Product', link: '/guide/' },
      { text: 'Admin', link: '/admin/' },
      { text: 'Cloud', link: '/cloud/' },
      { text: 'Self-Hosting', link: '/self-hosting/' },
      { text: 'Developers', link: '/developers/' },
    ],

    sidebar: {
      '/getting-started/': startSidebar,
      '/guide/': guideSidebar,
      '/admin/': adminSidebar,
      '/platform/': adminSidebar,
      '/cloud/': cloudSidebar,
      '/self-hosting/': selfHostingSidebar,
      '/developers/': developerSidebar,
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/iamabhishekmathur/hearth' }],

    editLink: {
      pattern: 'https://github.com/iamabhishekmathur/hearth/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
    },

    footer: {
      message: 'Released under the AGPL v3 License.',
      copyright: 'Copyright 2026 Hearth Contributors',
    },
  },

  appearance: true,

  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
  ],

  markdown: {
    lineNumbers: true,
  },
});
