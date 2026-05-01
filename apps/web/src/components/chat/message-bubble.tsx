import { useState, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage, ChatAttachment, MessageAuthor } from '@hearth/shared';
import type { Artifact } from '@/hooks/use-artifacts';
import { ArtifactBadge } from './artifact-badge';
import { HAvatar } from '@/components/ui/primitives';
import { authorColor, authorInitials } from '@/lib/author-color';

function ensureClosedCodeFences(content: string): string {
  const fenceCount = (content.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) return content + '\n```';
  return content;
}

const MemoizedSyntaxHighlighter = memo(SyntaxHighlighter);

interface CitationSource {
  index: number;
  type: string;
  label: string;
  content: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
  artifacts?: Artifact[];
  onOpenArtifact?: (id: string) => void;
  author?: MessageAuthor;
  showAuthor?: boolean;
  respondingToAuthor?: MessageAuthor;
}

function renderWithCitations(text: string, sources?: CitationSource[]): React.ReactNode {
  if (!sources || sources.length === 0) return text;
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (!match) return part;
    const idx = parseInt(match[1], 10);
    const source = sources.find((s) => s.index === idx);
    if (!source) return part;
    return (
      <span
        key={i}
        className="ml-0.5 inline-flex cursor-help items-center justify-center rounded-sm px-1 align-super text-[9px] font-bold"
        style={{ background: 'var(--hearth-accent-soft)', color: 'var(--hearth-accent)' }}
        title={`[${source.type}] ${source.label}: ${source.content.slice(0, 150)}`}
      >
        {idx}
      </span>
    );
  });
}

export function MessageBubble({ message, artifacts, onOpenArtifact, author, showAuthor, respondingToAuthor }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const messageArtifacts = artifacts?.filter((a) => a.parentMessageId === message.id) ?? [];
  const attachments = message.attachments ?? [];
  const messageSources = (message.metadata as Record<string, unknown>)?.sources as CitationSource[] | undefined;

  if (isUser) {
    const color = author ? authorColor(author.id) : null;
    const initials = author ? authorInitials(author.name) : null;
    return (
      <div className="flex flex-col items-end animate-fade-in">
        {showAuthor && author && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-hearth-text-muted">
            <span>{author.name}</span>
          </div>
        )}
        <div className="flex max-w-[70%] items-end gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="rounded-2xl rounded-br-[4px] px-4 py-3 text-[14px] leading-[1.55] font-[450]"
              style={
                color
                  ? { background: color.fill, color: color.text }
                  : { background: 'var(--hearth-text)', color: 'var(--hearth-text-inverse)' }
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
            {attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                {attachments.map((att) => (
                  <AttachmentDisplay key={att.id} attachment={att} />
                ))}
              </div>
            )}
          </div>
          {showAuthor && color && initials && (
            <div
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
              style={{ background: color.fill, color: color.text }}
              title={author?.name}
            >
              {initials}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start animate-fade-in">
      <HAvatar kind="agent" />
      <div className="flex-1 min-w-0">
        {respondingToAuthor && (
          <p className="mb-1 text-[11px] text-hearth-text-faint">
            <span aria-hidden>↳ </span>replying to <span className="font-medium text-hearth-text-muted">{respondingToAuthor.name}</span>
          </p>
        )}
        <div className="prose prose-sm max-w-none text-[14.5px] leading-[1.6] text-hearth-text prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1 prose-headings:font-semibold prose-strong:text-hearth-text prose-code:text-hearth-accent prose-code:bg-hearth-chip prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12.5px] prose-code:font-mono prose-code:font-normal">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p({ children }) {
                if (!messageSources || messageSources.length === 0) {
                  return <p>{children}</p>;
                }
                const processNode = (node: React.ReactNode): React.ReactNode => {
                  if (typeof node === 'string') return renderWithCitations(node, messageSources);
                  return node;
                };
                const processedChildren = Array.isArray(children)
                  ? children.map((child, i) => <span key={i}>{processNode(child)}</span>)
                  : processNode(children);
                return <p>{processedChildren}</p>;
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeString = String(children).replace(/\n$/, '');
                if (match) {
                  return (
                    <MemoizedSyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{ borderRadius: 'var(--hearth-radius-md)', fontSize: '12.5px' }}
                    >
                      {codeString}
                    </MemoizedSyntaxHighlighter>
                  );
                }
                return <code {...props}>{children}</code>;
              },
            }}
          >
            {message.id === '__streaming__' ? ensureClosedCodeFences(message.content) : message.content}
          </ReactMarkdown>
        </div>
        {messageArtifacts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {messageArtifacts.map((artifact) => (
              <ArtifactBadge key={artifact.id} title={artifact.title} type={artifact.type} onClick={() => onOpenArtifact?.(artifact.id)} />
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <AttachmentDisplay key={att.id} attachment={att} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentDisplay({ attachment }: { attachment: ChatAttachment }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isImage = attachment.mimeType.startsWith('image/');

  if (isImage) {
    return (
      <>
        <button type="button" onClick={() => setLightboxOpen(true)} className="overflow-hidden rounded-lg focus:outline-none">
          <img src={attachment.url} alt={attachment.filename} className="max-h-64 rounded-lg object-cover" />
        </button>
        {lightboxOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setLightboxOpen(false)} role="dialog">
            <img src={attachment.url} alt={attachment.filename} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </>
    );
  }

  return (
    <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-hearth-border bg-hearth-chip px-3 py-2 hover:opacity-80">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-hearth-card-alt text-hearth-text-muted">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" clipRule="evenodd" /></svg>
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-hearth-text">{attachment.filename}</p>
        <p className="text-[10px] text-hearth-text-faint">{formatFileSize(attachment.sizeBytes)}</p>
      </div>
    </a>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
