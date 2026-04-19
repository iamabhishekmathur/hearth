import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage, ChatAttachment } from '@hearth/shared';
import type { Artifact } from '@/hooks/use-artifacts';
import { ArtifactBadge } from './artifact-badge';

interface MessageBubbleProps {
  message: ChatMessage;
  /** Artifacts linked to messages in this session */
  artifacts?: Artifact[];
  /** Callback to open an artifact in the side panel */
  onOpenArtifact?: (id: string) => void;
}

export function MessageBubble({ message, artifacts, onOpenArtifact }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const messageArtifacts = artifacts?.filter((a) => a.parentMessageId === message.id) ?? [];
  const attachments = message.attachments ?? [];

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-br-md bg-hearth-500 px-4 py-2.5 text-white shadow-sm">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
          {attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
              {attachments.map((att) => (
                <AttachmentDisplay key={att.id} attachment={att} variant="user" />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[75%]">
        <div className="rounded-2xl rounded-bl-md bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100">
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-sm prose-headings:font-semibold prose-h1:text-sm prose-h2:text-sm prose-h3:text-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeString = String(children).replace(/\n$/, '');

                  if (match) {
                    return (
                      <SyntaxHighlighter
                        style={oneDark}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                          borderRadius: '0.5rem',
                          fontSize: '0.8125rem',
                        }}
                      >
                        {codeString}
                      </SyntaxHighlighter>
                    );
                  }

                  return (
                    <code
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-hearth-700"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
          {messageArtifacts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
              {messageArtifacts.map((artifact) => (
                <ArtifactBadge
                  key={artifact.id}
                  title={artifact.title}
                  type={artifact.type}
                  onClick={() => onOpenArtifact?.(artifact.id)}
                />
              ))}
            </div>
          )}
        </div>
        {attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <AttachmentDisplay key={att.id} attachment={att} variant="assistant" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentDisplay({
  attachment,
  variant,
}: {
  attachment: ChatAttachment;
  variant: 'user' | 'assistant';
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isImage = attachment.mimeType.startsWith('image/');

  const openLightbox = useCallback(() => {
    if (isImage) setLightboxOpen(true);
  }, [isImage]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={openLightbox}
          className="overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-hearth-400"
        >
          <img
            src={attachment.url}
            alt={attachment.filename}
            className="max-h-64 rounded-lg object-cover"
          />
        </button>
        {lightboxOpen && (
          <ImageLightbox
            url={attachment.url}
            filename={attachment.filename}
            onClose={closeLightbox}
          />
        )}
      </>
    );
  }

  const borderColor = variant === 'user' ? 'border-hearth-400/30' : 'border-gray-200';
  const bgColor = variant === 'user' ? 'bg-hearth-400/10' : 'bg-gray-50';
  const textColor = variant === 'user' ? 'text-hearth-100' : 'text-gray-700';
  const subtextColor = variant === 'user' ? 'text-hearth-200' : 'text-gray-400';

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 rounded-lg border ${borderColor} ${bgColor} px-3 py-2 transition-colors hover:opacity-80`}
    >
      <FileIcon mimeType={attachment.mimeType} />
      <div className="min-w-0">
        <p className={`truncate text-xs font-medium ${textColor}`}>
          {attachment.filename}
        </p>
        <p className={`text-[10px] ${subtextColor}`}>
          {formatFileSize(attachment.sizeBytes)}
        </p>
      </div>
    </a>
  );
}

function ImageLightbox({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-label={`Full size view of ${filename}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
      <img
        src={url}
        alt={filename}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isPdf = mimeType === 'application/pdf';
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-200 text-gray-500">
      {isPdf ? (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
