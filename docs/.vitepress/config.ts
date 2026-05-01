import { defineConfig } from 'vitepress';

const commonSidebar = [
  {
    text: 'Get started',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/' },
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'User Guide', link: '/guide/' },
      { text: 'Admin Guide', link: '/platform/' },
      { text: 'Self-Hosting', link: '/self-hosting/' },
    ],
  },
  {
    text: 'Developers',
    collapsed: false,
    items: [
      { text: 'Developer Overview', link: '/developers/' },
      { text: 'API Reference', link: '/developers/api/' },
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
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'User Guide', link: '/guide/' },
      { text: 'Admin Guide', link: '/platform/' },
      { text: 'Developers', link: '/developers/' },
      { text: 'Self-Hosting', link: '/self-hosting/' },
    ],

    sidebar: {
      '/getting-started/': commonSidebar,
      '/guide/': commonSidebar,
      '/platform/': commonSidebar,
      '/self-hosting/': commonSidebar,
      '/developers/': commonSidebar,
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

  appearance: true,

  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
  ],

  markdown: {
    lineNumbers: true,
  },
});
