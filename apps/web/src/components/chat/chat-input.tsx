import { useState, useRef, useCallback, type KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  /** If set, shows a prompt instead of the input (e.g. "Join conversation" or "Duplicate to chat") */
  accessPrompt?: {
    label: string;
    onClick: () => void;
  };
}

export function ChatInput({ onSend, disabled, accessPrompt }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, []);

  // Show access prompt instead of input for viewers
  if (accessPrompt) {
    return (
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-center">
          <button
            type="button"
            onClick={accessPrompt.onClick}
            className="rounded-xl border border-hearth-300 bg-hearth-50 px-4 py-2.5 text-sm font-medium text-hearth-700 transition-colors hover:bg-hearth-100"
          >
            {accessPrompt.label}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-hearth-400 focus:bg-white focus:ring-2 focus:ring-hearth-100 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hearth-500 text-white shadow-sm transition-colors hover:bg-hearth-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M3.105 2.29a.75.75 0 0 0-.826.95l1.414 4.925A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086L2.28 16.76a.75.75 0 0 0 .826.95l15-4.5a.75.75 0 0 0 0-1.42l-15-4.5Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
