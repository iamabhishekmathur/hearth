import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ClipboardEvent } from 'react';
import { api } from '@/lib/api-client';

export interface PendingAttachment {
  id?: string; // Set after upload completes
  file: File;
  preview?: string; // Data URL for image preview
  uploading: boolean;
  error?: string;
}

export interface MentionUser {
  id: string;
  name: string;
  email: string;
}

interface ChatInputProps {
  onSend: (content: string, attachments: PendingAttachment[], mentionUser?: MentionUser) => void;
  disabled?: boolean;
  /** If set, shows a prompt instead of the input (e.g. "Join conversation" or "Duplicate to chat") */
  accessPrompt?: {
    label: string;
    onClick: () => void;
  };
  /** Whether @mention cognitive queries are available */
  cognitiveEnabled?: boolean;
}

const ACCEPTED_TYPES = 'image/*,application/pdf,text/*,application/json';

export function ChatInput({ onSend, disabled, accessPrompt, cognitiveEnabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectedMention, setSelectedMention] = useState<MentionUser | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Detect @mention at the start of input
  useEffect(() => {
    if (!cognitiveEnabled) {
      setMentionQuery(null);
      return;
    }

    const match = value.match(/^@(\S*)$/);
    if (match && match[1].length >= 2) {
      const query = match[1];
      setMentionQuery(query);

      // Debounced search
      if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
      mentionDebounceRef.current = setTimeout(async () => {
        try {
          const res = await api.get<{ data: MentionUser[] }>(
            `/chat/users/search?q=${encodeURIComponent(query)}`,
          );
          setMentionResults(res.data);
          setMentionIndex(0);
        } catch {
          setMentionResults([]);
        }
      }, 200);
    } else if (!value.startsWith('@') || value.includes(' ')) {
      setMentionQuery(null);
      setMentionResults([]);
    }

    return () => {
      if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
    };
  }, [value, cognitiveEnabled]);

  const selectMention = useCallback(
    (user: MentionUser) => {
      setSelectedMention(user);
      setValue(`@${user.name} `);
      setMentionQuery(null);
      setMentionResults([]);
      textareaRef.current?.focus();
    },
    [],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: PendingAttachment[] = Array.from(files).map((file) => {
      const attachment: PendingAttachment = {
        file,
        uploading: false,
      };
      // Generate preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.file === file ? { ...a, preview: e.target?.result as string } : a,
            ),
          );
        };
        reader.readAsDataURL(file);
      }
      return attachment;
    });
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments, selectedMention ?? undefined);
    setValue('');
    setAttachments([]);
    setSelectedMention(null);
    setMentionResults([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, attachments, disabled, onSend, selectedMention]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle mention autocomplete navigation
      if (mentionResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((prev) => Math.min(prev + 1, mentionResults.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          selectMention(mentionResults[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          setMentionResults([]);
          setMentionQuery(null);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionResults, mentionIndex, selectMention],
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
      // Reset so the same file can be selected again
      e.target.value = '';
    },
    [addFiles],
  );

  const handleScreenshot = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
      }

      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `screenshot-${Date.now()}.png`, {
            type: 'image/png',
          });
          addFiles([file]);
        }
      }, 'image/png');
    } catch {
      // User cancelled or API not available — silently ignore
    }
  }, [addFiles]);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  // Show access prompt instead of input for viewers
  if (accessPrompt) {
    return (
      <div className="border-t border-hearth-border bg-hearth-card px-4 py-3">
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
    <div className="border-t border-hearth-border bg-hearth-card px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="group relative flex items-center gap-2 rounded-lg border border-hearth-border bg-hearth-bg px-2 py-1.5"
              >
                {att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.file.name}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-hearth-chip">
                    <svg className="h-5 w-5 text-hearth-text-muted" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
                <div className="max-w-[120px]">
                  <p className="truncate text-xs font-medium text-hearth-text">
                    {att.file.name}
                  </p>
                  <p className="text-[10px] text-hearth-text-faint">
                    {formatFileSize(att.file.size)}
                  </p>
                </div>
                {att.error && (
                  <span className="text-[10px] text-red-500">{att.error}</span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-400 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* @mention autocomplete dropdown */}
        {mentionResults.length > 0 && mentionQuery !== null && (
          <div className="mb-1 rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-3">
            <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-hearth-text-faint">
              Ask as someone's perspective
            </div>
            {mentionResults.map((user, i) => (
              <button
                key={user.id}
                type="button"
                onClick={() => selectMention(user)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  i === mentionIndex ? 'bg-hearth-50 text-hearth-700' : 'text-hearth-text hover:bg-hearth-bg'
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-hearth-100 text-xs font-medium text-hearth-600">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs text-hearth-text-faint">{user.email}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected mention badge */}
        {selectedMention && (
          <div className="mb-1 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-hearth-100 px-2.5 py-0.5 text-xs font-medium text-hearth-700">
              Asking as @{selectedMention.name}'s perspective
              <button
                type="button"
                onClick={() => {
                  setSelectedMention(null);
                  setValue(value.replace(/^@\S+\s?/, ''));
                }}
                className="ml-0.5 text-hearth-400 hover:text-hearth-600"
              >
                &times;
              </button>
            </span>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Attachment button */}
          <button
            type="button"
            onClick={handleFileSelect}
            disabled={disabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-hearth-text-faint transition-colors hover:bg-hearth-chip hover:text-hearth-text-muted disabled:cursor-not-allowed disabled:opacity-40"
            title="Attach file"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243l7-7a1 1 0 0 1 1.414 1.414l-7 7a5 5 0 0 1-7.071-7.071l7-7a3 3 0 0 1 4.243 4.243l-7 7a1 1 0 0 1-1.414-1.414l7-7a1 1 0 0 0 0-1.414Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {/* Screenshot button */}
          <button
            type="button"
            onClick={handleScreenshot}
            disabled={disabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-hearth-text-faint transition-colors hover:bg-hearth-chip hover:text-hearth-text-muted disabled:cursor-not-allowed disabled:opacity-40"
            title="Take screenshot"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 16.07 6H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder="Type a message..."
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-hearth-border-strong bg-hearth-bg px-4 py-2.5 text-sm text-hearth-text placeholder-hearth-text-faint outline-none transition-colors focus:border-hearth-400 focus:bg-hearth-card focus:ring-2 focus:ring-hearth-100 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hearth-500 text-white shadow-hearth-1 transition-colors hover:bg-hearth-600 disabled:cursor-not-allowed disabled:opacity-40"
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
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
