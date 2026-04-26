import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Artifact } from '@/hooks/use-artifacts';

export function ArtifactContent({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case 'code':
      return (
        <div className="overflow-hidden rounded-lg shadow-hearth-1">
          {artifact.language && (
            <div className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ background: 'var(--hearth-chip)', color: 'var(--hearth-text-faint)' }}>
              {artifact.language}
            </div>
          )}
          <SyntaxHighlighter
            style={oneDark}
            language={artifact.language ?? 'text'}
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: artifact.language ? '0 0 0.5rem 0.5rem' : '0.5rem',
              fontSize: '0.8125rem',
              lineHeight: '1.6',
              padding: '1.25rem',
            }}
          >
            {artifact.content}
          </SyntaxHighlighter>
        </div>
      );

    case 'document':
      return (
        <article className="prose prose max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-xl prose-h1:mb-4 prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2 prose-p:leading-relaxed prose-p:text-hearth-text-muted prose-li:text-hearth-text-muted prose-strong:text-hearth-text prose-table:text-sm prose-th:text-left prose-th:font-semibold prose-th:text-hearth-text prose-td:text-hearth-text-muted">
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
                        lineHeight: '1.6',
                      }}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  );
                }

                return (
                  <code
                    className="rounded-md bg-hearth-chip px-1.5 py-0.5 text-[13px] font-medium text-hearth-accent"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {artifact.content}
          </ReactMarkdown>
        </article>
      );

    case 'diagram':
      return (
        <div className="overflow-hidden rounded-lg shadow-hearth-1">
          <div className="bg-gray-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-hearth-text-faint">
            Mermaid
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language="text"
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: '0 0 0.5rem 0.5rem',
              fontSize: '0.8125rem',
              lineHeight: '1.6',
              padding: '1.25rem',
            }}
          >
            {artifact.content}
          </SyntaxHighlighter>
        </div>
      );

    case 'table':
      return (
        <div className="overflow-auto rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-1">
          <div
            className="prose prose max-w-none prose-table:m-0 prose-th:text-left prose-th:font-semibold"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(artifact.content) }}
          />
        </div>
      );

    case 'html':
      return (
        <div className="overflow-auto rounded-lg border border-hearth-border bg-hearth-card p-6 shadow-hearth-1">
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(artifact.content) }} />
        </div>
      );

    case 'image':
      return (
        <div className="flex items-center justify-center py-4">
          <img
            src={artifact.content}
            alt={artifact.title}
            className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-hearth-1"
          />
        </div>
      );

    default:
      return (
        <pre className="whitespace-pre-wrap rounded-lg bg-hearth-card p-6 text-sm leading-relaxed text-hearth-text shadow-hearth-1 ring-1 ring-hearth-border">
          {artifact.content}
        </pre>
      );
  }
}
