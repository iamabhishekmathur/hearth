import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ClipboardEvent } from 'react';
import { api } from '@/lib/api-client';
import { emitTyping, emitComposing, emitHeartbeat } from '@/lib/socket-client';
import type { ComposingUser, PresenceUser } from '@hearth/shared';
import { TaskComposer, type TaskComposerSubmit } from './task-composer';

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
  /** Active session id — used for presence emission */
  sessionId?: string | null;
  /** Other users currently typing (excludes me) */
  typingUsers?: PresenceUser[];
  /** Other users currently composing (excludes me) */
  composingUsers?: ComposingUser[];
  /** Anchor message id for /task slash composer (typically the latest message in the session) */
  latestMessageId?: string | null;
}

const ACCEPTED_TYPES = 'image/*,application/pdf,text/*,application/json';

export function ChatInput({ onSend, disabled, accessPrompt, sessionId, typingUsers, composingUsers, latestMessageId }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [taskSlashOpen, setTaskSlashOpen] = useState(false);
  const [taskSlashSeed, setTaskSlashSeed] = useState('');
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composingThresholdsHitRef = useRef<Set<number>>(new Set());
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mentionStartRef = useRef<number>(-1);

  // Detect an @mention being typed at the cursor — anywhere in the message, not
  // just at the start. @ must begin the line or follow whitespace (so emails
  // like a@b.com don't trigger it).
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);

    const cursor = e.target.selectionStart ?? v.length;
    const before = v.slice(0, cursor);
    const match = before.match(/(?:^|\s)@(\w*)$/);
    if (match) {
      const query = match[1];
      mentionStartRef.current = cursor - query.length - 1; // index of the '@'
      setMentionQuery(query);
      if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
      mentionDebounceRef.current = setTimeout(async () => {
        try {
          const res = await api.get<{ data: MentionUser[] }>(
            `/chat/users/search?q=${encodeURIComponent(query || '')}`,
          );
          setMentionResults(res.data);
          setMentionIndex(0);
        } catch {
          setMentionResults([]);
        }
      }, 150);
    } else {
      setMentionQuery(null);
      setMentionResults([]);
    }
  }, []);

  // Replace the @query being typed with the chosen teammate's name (keeps the
  // rest of the message intact, so multiple mentions work).
  const selectMention = useCallback(
    (user: MentionUser) => {
      const ta = textareaRef.current;
      const start = mentionStartRef.current;
      if (start < 0) return;
      const cursor = ta?.selectionStart ?? value.length;
      const insert = `@${user.name} `;
      const next = value.slice(0, start) + insert + value.slice(cursor);
      setValue(next);
      setMentionQuery(null);
      setMentionResults([]);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        const pos = start + insert.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [value],
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
    // Intercept /task — open the inline composer instead of sending to the agent.
    const slashMatch = /^\/task(?:\s+(.*))?$/.exec(trimmed);
    if (slashMatch && sessionId && latestMessageId) {
      setTaskSlashSeed(slashMatch[1]?.trim() ?? '');
      setTaskSlashOpen(true);
      setValue('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }
    onSend(trimmed, attachments, undefined);
    setValue('');
    setAttachments([]);
    setMentionResults([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, attachments, disabled, onSend, sessionId, latestMessageId]);

  const handleTaskSlashSubmit = useCallback((_result: TaskComposerSubmit) => {
    setTaskSlashOpen(false);
    setTaskSlashSeed('');
  }, []);

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

  // Emit typing (3s debounce) and composing-at-thresholds whenever value changes.
  useEffect(() => {
    if (!sessionId) return;
    const len = value.length;

    // Typing: fire on every keystroke; server collapses with TTL.
    if (len > 0) {
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      emitTyping(sessionId);
      typingDebounceRef.current = setTimeout(() => {
        // Re-emit if still typing 3s later (keeps server TTL alive)
        if (textareaRef.current?.value && textareaRef.current.value.length > 0) {
          emitTyping(sessionId);
        }
      }, 3_000);
    }

    // Composing thresholds: 1, 50, 200 chars (each fires once per crossing)
    const thresholds = [1, 50, 200];
    for (const t of thresholds) {
      if (len >= t && !composingThresholdsHitRef.current.has(t)) {
        composingThresholdsHitRef.current.add(t);
        emitComposing(sessionId, len);
      }
    }
    if (len === 0) composingThresholdsHitRef.current.clear();
  }, [value, sessionId]);

  // Heartbeat while focused, to defer the server-side idle sweep.
  useEffect(() => {
    if (!sessionId || !focused) {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
      return;
    }
    emitHeartbeat(sessionId);
    heartbeatIntervalRef.current = setInterval(() => emitHeartbeat(sessionId), 30_000);
    return () => {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    };
  }, [sessionId, focused]);

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

  const mentionSegments = parseMentionSegments(value);

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
              Mention a teammate
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

        {/* Slash-command /task composer */}
        {taskSlashOpen && sessionId && latestMessageId && (
          <div className="mb-2">
            <TaskComposer
              sessionId={sessionId}
              anchorMessageId={latestMessageId}
              provenance="chat_slash"
              initialTitle={taskSlashSeed}
              initialAttachRecentN={6}
              onSubmit={handleTaskSlashSubmit}
              onCancel={() => { setTaskSlashOpen(false); setTaskSlashSeed(''); }}
            />
          </div>
        )}

        {/* Composing / typing presence */}
        <PresenceBanner typingUsers={typingUsers ?? []} composingUsers={composingUsers ?? []} myInputFocused={focused} />

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

          {/* Mention-aware input: a transparent textarea over a styled backdrop
              that renders @mentions as chips. The chip is a background tint only
              (no padding/weight change) so glyph widths — and the caret — stay
              aligned with the textarea text. */}
          <div className="relative flex-1">
            <div
              ref={backdropRef}
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-xl border border-transparent px-4 py-2.5 text-sm leading-5 text-hearth-text ${focused ? 'bg-hearth-card' : 'bg-hearth-bg'}`}
            >
              {mentionSegments.map((seg, i) =>
                seg.type === 'mention' ? (
                  <span key={i} className="hearth-mention-inline">{seg.value}</span>
                ) : (
                  <span key={i}>{seg.value}</span>
                ),
              )}
              {value.endsWith('\n') ? '\n' : null}
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              onScroll={() => {
                if (backdropRef.current && textareaRef.current) {
                  backdropRef.current.scrollTop = textareaRef.current.scrollTop;
                }
              }}
              onPaste={handlePaste}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Type a message..."
              disabled={disabled}
              rows={1}
              style={{ caretColor: 'var(--hearth-text, #111827)' }}
              className="relative block w-full resize-none rounded-xl border border-hearth-border-strong bg-transparent px-4 py-2.5 text-sm leading-5 text-transparent placeholder-hearth-text-faint outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
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

// Split composer text into plain + @mention segments for the styled backdrop.
// Matches @ + a Capitalized name (one or two words) — i.e. a chosen teammate.
const COMPOSER_MENTION_RE = /@[A-Z][A-Za-z'’.-]*(?:\s[A-Z][A-Za-z'’.-]*)?/g;
function parseMentionSegments(text: string): Array<{ type: 'text' | 'mention'; value: string }> {
  if (!text) return [];
  const segs: Array<{ type: 'text' | 'mention'; value: string }> = [];
  COMPOSER_MENTION_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPOSER_MENTION_RE.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', value: text.slice(last, m.index) });
    segs.push({ type: 'mention', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: 'text', value: text.slice(last) });
  return segs.length > 0 ? segs : [{ type: 'text', value: text }];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PresenceBanner({
  typingUsers,
  composingUsers,
  myInputFocused,
}: {
  typingUsers: PresenceUser[];
  composingUsers: ComposingUser[];
  myInputFocused: boolean;
}) {
  // Composing takes precedence over typing in the message — composing implies typing.
  const composingNames = composingUsers.map((u) => u.name);
  const typingOnly = typingUsers
    .filter((t) => !composingUsers.some((c) => c.userId === t.userId))
    .map((t) => t.name);

  // Soft-warn: only when I'm focused AND someone else is composing.
  const showSoftWarn = myInputFocused && composingUsers.length > 0;

  if (composingNames.length === 0 && typingOnly.length === 0) return null;

  const summary = (() => {
    if (composingNames.length > 0) {
      const names = formatNameList(composingNames);
      return `${names} ${composingNames.length === 1 ? 'is' : 'are'} composing a prompt…`;
    }
    const names = formatNameList(typingOnly);
    return `${names} ${typingOnly.length === 1 ? 'is' : 'are'} typing…`;
  })();

  return (
    <div className="mb-1 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] text-hearth-text-faint">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--hearth-accent)' }} />
        <span>{summary}</span>
      </div>
      {showSoftWarn && (
        <div
          className="inline-flex items-center gap-1.5 self-start rounded-md px-2 py-0.5 text-[11px]"
          style={{
            background: 'color-mix(in srgb, var(--hearth-warn) 12%, transparent)',
            color: 'var(--hearth-warn)',
          }}
        >
          <span aria-hidden>⚠</span>
          <span>Your prompt may interleave with theirs — consider waiting.</span>
        </div>
      )}
    </div>
  );
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 > 1 ? 's' : ''}`;
}
