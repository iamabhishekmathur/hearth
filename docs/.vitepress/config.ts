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
      { text: 'Admin Guide', link: '/platform/' },
      { text: 'Developers', link: '/developers/' },
      { text: 'Self-Hosting', link: '/self-hosting/' },
    ],

    sidebar: {
      // Single-page guides — no sidebar, use on-page TOC
      '/getting-started/': [],
      '/guide/': [],
      '/platform/': [],
      '/self-hosting/': [],

      // Multi-page developer reference — sidebar navigation
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
