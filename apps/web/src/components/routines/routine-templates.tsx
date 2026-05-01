import { useState, useMemo } from 'react';

export interface RoutineTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  category: string;
  icon: string;
}

const TEMPLATES: RoutineTemplate[] = [
  {
    id: 'weekly-brief',
    name: 'Weekly brief with Slack + Notion',
    description: 'Reads this week\'s meetings and notes, then posts a summary to Slack.',
    prompt: `Check @Google Calendar for this week's meetings and find related notes in @Notion.

For each meeting, summarize:
- Key decisions made
- Action items with owners
- Open questions

Post the compiled weekly brief to @Slack #team-updates. Keep it concise — one paragraph per meeting, max.`,
    schedule: '0 17 * * 5',
    category: 'Team',
    icon: 'T',
  },
  {
    id: 'standup-prep',
    name: 'Daily standup prep',
    description: 'Pulls yesterday\'s activity and today\'s calendar to prepare your standup.',
    prompt: `Check @Google Calendar for today's meetings and review what I worked on yesterday.

Prepare my daily standup update:
- **Yesterday:** What I completed or made progress on
- **Today:** Key meetings and what I'm planning to work on
- **Blockers:** Anything slowing me down

Keep each section to 2-3 bullet points max.`,
    schedule: '0 8 * * 1-5',
    category: 'Personal',
    icon: 'S',
  },
  {
    id: 'meeting-prep',
    name: 'Meeting prep from Notion + Calendar',
    description: 'Pulls tomorrow\'s meetings and finds relevant context from Notion.',
    prompt: `Check @Google Calendar for tomorrow's meetings. For each meeting:
1. Find related pages in @Notion (search by meeting title and attendee names)
2. Summarize relevant context, recent decisions, and open items
3. Flag any meetings that have no context — I may need to prep manually

Format as a brief per meeting with the context I need to walk in prepared.`,
    schedule: '0 18 * * 0-4',
    category: 'Personal',
    icon: 'M',
  },
  {
    id: 'pr-review-digest',
    name: 'PR review digest from GitHub',
    description: 'Pulls open PRs from GitHub and posts a review digest to Slack.',
    prompt: `Check @GitHub for open pull requests in our repositories.

Compile a digest:
- PRs awaiting review (oldest first)
- PRs with requested changes
- PRs that have been open for more than 3 days
- Any PRs blocking other work

For each PR, include: title, author, age, and number of comments.
Post the digest to @Slack #engineering.`,
    schedule: '0 9 * * 1-5',
    category: 'Engineering',
    icon: 'P',
  },
  {
    id: 'customer-feedback',
    name: 'Customer feedback roundup',
    description: 'Scans Slack support channels and clusters feedback into themes.',
    prompt: `Search @Slack #support and #feedback channels for customer messages from the past week.

Analyze and produce:
- Top 3-5 themes or recurring requests
- Notable positive feedback worth sharing
- Any urgent issues or escalations
- Suggested next steps for the product team

Post the roundup to @Slack #product-team. Prioritize by frequency and severity.`,
    schedule: '0 9 * * 1',
    category: 'Product',
    icon: 'C',
  },
  {
    id: 'incident-review',
    name: 'Incident review prep',
    description: 'Prepares a timeline and impact summary for post-incident reviews.',
    prompt: `Prepare an incident review document from recent alerts and communications:
- Timeline of events (when detected, who responded, what actions taken)
- Impact: users affected, duration, severity
- Root cause analysis (what went wrong and why)
- Action items to prevent recurrence

Format as a structured postmortem template.`,
    schedule: '0 10 * * 1',
    category: 'Engineering',
    icon: 'I',
  },
  {
    id: 'sprint-retro',
    name: 'Sprint retro facilitator',
    description: 'Pulls completed work from the sprint and drafts a retrospective agenda.',
    prompt: `Prepare a sprint retrospective agenda based on this sprint's completed work:
- What we shipped: list completed items with brief descriptions
- Velocity: how did we do against our sprint goal?
- What went well: patterns that worked
- What could improve: friction points or missed commitments
- Discussion topics for the team

Keep it factual, not opinionated — let the team discuss.`,
    schedule: '0 14 * * 5',
    category: 'Team',
    icon: 'R',
  },
  {
    id: 'weekly-metrics',
    name: 'Weekly metrics report',
    description: 'Pulls key metrics, compares to last week, and highlights notable changes.',
    prompt: `Generate a weekly metrics report:
- Key metrics with current values and week-over-week change
- Highlight anything that moved more than 10% in either direction
- Any metrics trending in a concerning direction over the past 4 weeks
- Brief executive summary (2-3 sentences)

Present as a clean table with sparkline-style trend indicators.`,
    schedule: '0 8 * * 1',
    category: 'Product',
    icon: 'W',
  },
];

const CATEGORIES = ['All', ...Array.from(new Set(TEMPLATES.map((t) => t.category)))];

const CATEGORY_COLORS: Record<string, string> = {
  Team: 'bg-blue-100 text-blue-700',
  Personal: 'bg-purple-100 text-purple-700',
  Engineering: 'bg-green-100 text-green-700',
  Product: 'bg-amber-100 text-amber-700',
};

const INTEGRATION_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  Slack: { label: 'Slack', color: 'text-purple-700', bg: 'bg-purple-50 ring-purple-200' },
  GitHub: { label: 'GitHub', color: 'text-hearth-text', bg: 'bg-hearth-bg ring-hearth-border' },
  Notion: { label: 'Notion', color: 'text-hearth-text', bg: 'bg-hearth-bg ring-hearth-border' },
  'Google Calendar': { label: 'Calendar', color: 'text-blue-700', bg: 'bg-blue-50 ring-blue-200' },
  Jira: { label: 'Jira', color: 'text-blue-700', bg: 'bg-blue-50 ring-blue-200' },
  Gmail: { label: 'Gmail', color: 'text-red-700', bg: 'bg-red-50 ring-red-200' },
};

/** Extract @Mentions from a template's prompt */
function extractMentions(prompt: string): string[] {
  const pattern = /@([\w]+(?:\s[\w]+)?)/g;
  const mentions = new Set<string>();
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    mentions.add(match[1].trim());
  }
  return Array.from(mentions);
}

interface RoutineTemplateBrowserProps {
  onSelect: (template: RoutineTemplate) => void;
  onClose?: () => void;
}

export function RoutineTemplateBrowser({ onSelect, onClose }: RoutineTemplateBrowserProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  const filtered = useMemo(() => {
    let list = TEMPLATES;
    if (category !== 'All') {
      list = list.filter((t) => t.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q),
      );
    }
    return list;
  }, [search, category]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hearth-border px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-hearth-text">Browse Templates</h2>
          <p className="mt-0.5 text-xs text-hearth-text-muted">
            Start with a template and customize it to your needs
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        )}
      </div>

      {/* Search + category filter */}
      <div className="border-b border-hearth-border px-6 py-3">
        <input
          type="text"
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                category === cat
                  ? 'bg-hearth-100 text-hearth-700 ring-1 ring-hearth-300'
                  : 'bg-hearth-chip text-hearth-text-muted hover:bg-hearth-chip'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Template grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-hearth-text-faint">No templates match your search</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((template) => {
              const mentions = extractMentions(template.prompt);
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onSelect(template)}
                  className="group rounded-lg border border-hearth-border p-4 text-left transition-all hover:border-hearth-300 hover:shadow-hearth-1 animate-fade-in"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-hearth-chip text-sm font-bold text-hearth-text-muted group-hover:bg-hearth-100 group-hover:text-hearth-600">
                      {template.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-hearth-text">{template.name}</h3>
                      <p className="mt-0.5 text-xs leading-relaxed text-hearth-text-muted">
                        {template.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[template.category] ?? 'bg-hearth-chip text-hearth-text-muted'}`}
                        >
                          {template.category}
                        </span>
                        <span className="text-[10px] text-hearth-text-faint">
                          {formatScheduleLabel(template.schedule)}
                        </span>
                        {mentions.length > 0 && (
                          <>
                            <span className="text-hearth-text-faint">&middot;</span>
                            {mentions.map((m) => {
                              const badge = INTEGRATION_BADGES[m];
                              return badge ? (
                                <span
                                  key={m}
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badge.bg} ${badge.color}`}
                                >
                                  {badge.label}
                                </span>
                              ) : null;
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatScheduleLabel(cron: string): string {
  const presets: Record<string, string> = {
    '0 * * * *': 'Hourly',
    '0 8 * * 1-5': 'Weekdays 8 AM',
    '0 9 * * *': 'Daily 9 AM',
    '0 9 * * 1-5': 'Weekdays 9 AM',
    '0 9 * * 1': 'Weekly Monday',
    '0 10 * * 1': 'Weekly Monday',
    '0 14 * * 5': 'Fridays 2 PM',
    '0 17 * * 5': 'Fridays 5 PM',
    '0 18 * * 1-5': 'Weekdays 6 PM',
    '0 18 * * 0-4': 'Sun-Thu 6 PM',
  };
  return presets[cron] ?? cron;
}
