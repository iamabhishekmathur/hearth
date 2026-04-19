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
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
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
          className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          aria-label="Add reaction"
        >
          +
        </button>

        {showPicker && (
          <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
            {Object.entries(EMOJI_MAP).map(([key, display]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleToggle(key)}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100"
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
