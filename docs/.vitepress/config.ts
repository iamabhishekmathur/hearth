import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Hearth Docs',
  description: 'Documentation for the Hearth AI productivity platform',

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'User Guide', link: '/guide/' },
      { text: 'Platform', link: '/platform/' },
      { text: 'Developers', link: '/developers/' },
      { text: 'Self-Hosting', link: '/self-hosting/' },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/getting-started/' },
            { text: 'Quickstart', link: '/getting-started/quickstart' },
            { text: 'First Run', link: '/getting-started/first-run' },
            { text: 'Configuration', link: '/getting-started/configuration' },
          ],
        },
      ],

      '/guide/': [],

      '/platform/': [
        {
          text: 'Platform',
          link: '/platform/',
          items: [
            { text: 'Users & Teams', link: '/platform/users-and-teams' },
            { text: 'Integrations', link: '/platform/integrations' },
            { text: 'LLM Configuration', link: '/platform/llm-config' },
            { text: 'Soul & Identity', link: '/platform/soul-and-identity' },
            { text: 'Governance', link: '/platform/governance' },
            { text: 'Compliance', link: '/platform/compliance' },
            { text: 'Analytics', link: '/platform/analytics' },
            { text: 'Audit Logs', link: '/platform/audit-logs' },
            { text: 'Digital Co-Worker', link: '/platform/cognitive-profiles' },
            { text: 'Decision Graph', link: '/platform/decision-graph' },
            { text: 'SSO', link: '/platform/sso' },
          ],
        },
      ],

      '/developers/': [
        {
          text: 'Developers',
          link: '/developers/',
          items: [
            {
              text: 'API Reference',
              collapsed: false,
              items: [
                { text: 'Overview', link: '/developers/api/' },
                { text: 'Chat & Sessions', link: '/developers/api/chat' },
                { text: 'Tasks', link: '/developers/api/tasks' },
                { text: 'Memory', link: '/developers/api/memory' },
                { text: 'Skills', link: '/developers/api/skills' },
                { text: 'Routines', link: '/developers/api/routines' },
                { text: 'Activity', link: '/developers/api/activity' },
                { text: 'Artifacts', link: '/developers/api/artifacts' },
                { text: 'Approvals', link: '/developers/api/approvals' },
                { text: 'Decisions', link: '/developers/api/decisions' },
                { text: 'Admin', link: '/developers/api/admin' },
                { text: 'Webhooks & Uploads', link: '/developers/api/webhooks' },
              ],
            },
            { text: 'WebSocket Events', link: '/developers/websocket-events' },
            {
              text: 'Architecture',
              collapsed: false,
              items: [
                { text: 'System Overview', link: '/developers/architecture/' },
                { text: 'Agent System', link: '/developers/architecture/agent' },
                { text: 'Database', link: '/developers/architecture/database' },
                { text: 'Services', link: '/developers/architecture/services' },
              ],
            },
            { text: 'SKILL.md Format', link: '/developers/skill-format' },
            { text: 'Skill Examples', link: '/developers/skill-examples' },
            {
              text: 'Connectors',
              collapsed: true,
              items: [
                { text: 'MCP Overview', link: '/developers/connectors/' },
                { text: 'Building Connectors', link: '/developers/connectors/building' },
              ],
            },
            {
              text: 'Contributing',
              collapsed: true,
              items: [
                { text: 'How to Contribute', link: '/developers/contributing/' },
                { text: 'Development Setup', link: '/developers/contributing/development' },
              ],
            },
          ],
        },
      ],

      '/self-hosting/': [
        {
          text: 'Self-Hosting',
          link: '/self-hosting/',
          items: [
            { text: 'Docker Compose', link: '/self-hosting/docker' },
            { text: 'Kubernetes & Helm', link: '/self-hosting/kubernetes' },
            { text: 'Production Checklist', link: '/self-hosting/production' },
            { text: 'Monitoring & Health', link: '/self-hosting/monitoring' },
            { text: 'Troubleshooting', link: '/self-hosting/troubleshooting' },
          ],
        },
      ],
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
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 Hearth Contributors',
    },
  },

  appearance: 'dark',

  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
  ],

  markdown: {
    lineNumbers: true,
  },
});
