import { useState } from 'react';
import type { ReactionSummary } from '@hearth/shared';

const EMOJI_MAP: Record<string, string> = {
  fire: '\u{1F525}',
  thumbsup: '\u{1F44D}',
  heart: '\u{2764}\u{FE0F}',
  eyes: '\u{1F440}',
  rocket: '\u{1F680}',
};

interface ReactionPickerProps {
  reactions: ReactionSummary[];
  currentUserId: string;
  onAdd: (emoji: string) => void;
  onRemove: (emoji: string) => void;
}

export function ReactionPicker({ reactions, currentUserId, onAdd, onRemove }: ReactionPickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleToggle = (emoji: string) => {
    const existing = reactions.find((r) => r.emoji === emoji);
    if (existing?.userIds.includes(currentUserId)) {
      onRemove(emoji);
    } else {
      onAdd(emoji);
    }
    setShowPicker(false);
  };

  return (
    <div className="flex items-center gap-1">
      {reactions.map((r) => {
        const isMine = r.userIds.includes(currentUserId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => handleToggle(r.emoji)}
            className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
              isMine
                ? 'border-hearth-300 bg-hearth-50 text-hearth-700'
                : 'border-hearth-border bg-hearth-card text-hearth-text-muted hover:bg-hearth-bg'
            }`}
          >
            <span>{EMOJI_MAP[r.emoji] ?? r.emoji}</span>
            <span>{r.count}</span>
          </button>
        );
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-hearth-border bg-hearth-card text-xs text-hearth-text-faint hover:bg-hearth-bg hover:text-hearth-text-muted"
          aria-label="Add reaction"
        >
          +
        </button>

        {showPicker && (
          <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-lg border border-hearth-border bg-hearth-card p-1.5 shadow-hearth-3">
            {Object.entries(EMOJI_MAP).map(([key, display]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleToggle(key)}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-hearth-chip"
                title={key}
              >
                {display}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
