import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

export interface IntegrationInfo {
  id: string;
  provider: string;
  label: string;
  tools: Array<{
    name: string;
    description: string;
    resourceParams: Array<{ name: string; description: string }>;
  }>;
}

// Known provider metadata — icons and colors
const PROVIDER_META: Record<string, { icon: string; color: string; bg: string }> = {
  slack: { icon: '#', color: 'text-purple-700', bg: 'bg-purple-100' },
  github: { icon: 'GH', color: 'text-gray-700', bg: 'bg-gray-200' },
  notion: { icon: 'N', color: 'text-gray-900', bg: 'bg-gray-100' },
  jira: { icon: 'J', color: 'text-blue-700', bg: 'bg-blue-100' },
  gmail: { icon: 'M', color: 'text-red-700', bg: 'bg-red-100' },
  gdrive: { icon: 'D', color: 'text-green-700', bg: 'bg-green-100' },
  gcalendar: { icon: 'C', color: 'text-blue-700', bg: 'bg-blue-100' },
};

export function getProviderMeta(provider: string) {
  return PROVIDER_META[provider] ?? { icon: provider.charAt(0).toUpperCase(), color: 'text-gray-700', bg: 'bg-gray-100' };
}

// Map mention labels (lowercase) → provider keys for pill rendering
const MENTION_PROVIDERS: Record<string, string> = {
  slack: 'slack',
  github: 'github',
  notion: 'notion',
  jira: 'jira',
  gmail: 'gmail',
  'google drive': 'gdrive',
  'google calendar': 'gcalendar',
};

// Pill styles per provider — ring-inset uses box-shadow so no layout impact
const PILL_CLASSES: Record<string, string> = {
  slack: 'bg-purple-100 text-purple-800 ring-1 ring-inset ring-purple-300/60',
  github: 'bg-gray-200 text-gray-800 ring-1 ring-inset ring-gray-300/60',
  notion: 'bg-gray-100 text-gray-900 ring-1 ring-inset ring-gray-300/60',
  jira: 'bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-300/60',
  gmail: 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-300/60',
  gdrive: 'bg-green-100 text-green-800 ring-1 ring-inset ring-green-300/60',
  gcalendar: 'bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-300/60',
};

const DEFAULT_PILL_CLASS = 'bg-gray-100 text-gray-800 ring-1 ring-inset ring-gray-300/60';

interface Segment {
  type: 'text' | 'mention';
  value: string;
  provider?: string;
}

/** Parse text into alternating plain-text and mention segments */
function parseSegments(text: string): Segment[] {
  if (!text) return [];

  const segments: Segment[] = [];
  const pattern = /@([\w]+(?:\s[\w]+)?)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const label = match[1].trim();
    const provider = MENTION_PROVIDERS[label.toLowerCase()];

    if (provider) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'mention', value: match[0], provider });
      lastIndex = match.index + match[0].length;
    }
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  return segments;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  integrations: IntegrationInfo[];
  placeholder?: string;
  rows?: number;
}

export function MentionTextarea({
  value,
  onChange,
  integrations,
  placeholder,
  rows = 5,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);

  const filteredIntegrations = integrations.filter(
    (i) =>
      !popoverFilter ||
      i.label.toLowerCase().includes(popoverFilter.toLowerCase()) ||
      i.provider.toLowerCase().includes(popoverFilter.toLowerCase()),
  );

  const segments = useMemo(() => parseSegments(value), [value]);

  // Sync scroll between textarea and backdrop
  const handleScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const cursorPos = e.target.selectionStart;
      const textBefore = newValue.slice(0, cursorPos);

      // Check if we're in an @ mention context
      const atMatch = textBefore.match(/@(\w*)$/);
      if (atMatch && integrations.length > 0) {
        setPopoverFilter(atMatch[1]);
        setMentionStart(cursorPos - atMatch[0].length);
        setSelectedIndex(0);

        // Position popover near the cursor
        const textarea = textareaRef.current;
        if (textarea) {
          const lines = textBefore.split('\n');
          const lineHeight = 20;
          const top = Math.min(lines.length * lineHeight, textarea.clientHeight - 20);
          setPopoverPos({ top: top + 4, left: 8 });
        }

        setShowPopover(true);
      } else {
        setShowPopover(false);
      }
    },
    [onChange, integrations],
  );

  const insertMention = useCallback(
    (integration: IntegrationInfo) => {
      if (mentionStart < 0) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const before = value.slice(0, mentionStart);
      const after = value.slice(cursorPos);
      const mention = `@${integration.label}`;
      const newValue = before + mention + ' ' + after;

      onChange(newValue);
      setShowPopover(false);

      requestAnimationFrame(() => {
        textarea.focus();
        const newPos = mentionStart + mention.length + 1;
        textarea.setSelectionRange(newPos, newPos);
      });
    },
    [value, onChange, mentionStart],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showPopover) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredIntegrations.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredIntegrations.length > 0) {
          e.preventDefault();
          insertMention(filteredIntegrations[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowPopover(false);
      }
    },
    [showPopover, filteredIntegrations, selectedIndex, insertMention],
  );

  // Close popover on click outside
  useEffect(() => {
    if (!showPopover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setShowPopover(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopover]);

  return (
    <div className="relative">
      {/* Overlay container: backdrop renders pills behind transparent textarea */}
      <div className="relative rounded-lg">
        {/* Backdrop: formatted text with mention pills (rendered first → below textarea) */}
        <div
          ref={backdropRef}
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent bg-white px-3 py-2 text-sm leading-5"
          style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word' }}
          aria-hidden="true"
        >
          {segments.map((seg, i) => {
            if (seg.type === 'mention' && seg.provider) {
              const cls = PILL_CLASSES[seg.provider] ?? DEFAULT_PILL_CLASS;
              return (
                <span key={i} className={`rounded ${cls}`}>
                  {seg.value}
                </span>
              );
            }
            return <span key={i} className="text-gray-900">{seg.value}</span>;
          })}
          {/* Match textarea trailing-newline behavior */}
          {value.endsWith('\n') && '\n'}
        </div>

        {/* Textarea: transparent text + bg, caret stays visible */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          placeholder={placeholder}
          rows={rows}
          className="relative block w-full resize-none rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm leading-5 text-transparent shadow-sm placeholder:text-gray-400 focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          style={{ caretColor: '#111827' }}
        />
      </div>

      {/* @ mention popover */}
      {showPopover && filteredIntegrations.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute z-10 w-72 rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
              Select an integration
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredIntegrations.map((integ, idx) => {
              const meta = getProviderMeta(integ.provider);
              return (
                <button
                  key={integ.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(integ);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    idx === selectedIndex ? 'bg-hearth-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${meta.bg} ${meta.color}`}>
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{integ.label}</p>
                    <p className="truncate text-[11px] text-gray-400">
                      {integ.tools.map((t) => humanToolName(t.name)).join(', ')}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredIntegrations.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-400">No matching integrations</p>
          )}
        </div>
      )}

      {/* Inline hint below textarea */}
      {integrations.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          Type <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono text-[10px]">@</kbd> to add integrations
        </p>
      )}
    </div>
  );
}

/** Convert tool_name to human-readable: "slack_post_message" → "Post message" */
function humanToolName(name: string): string {
  // Strip provider prefix
  const parts = name.split('_');
  const withoutProvider = parts.length > 1 ? parts.slice(1).join(' ') : name;
  return withoutProvider.charAt(0).toUpperCase() + withoutProvider.slice(1);
}
