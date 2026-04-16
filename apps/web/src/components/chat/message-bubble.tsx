import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage } from '@hearth/shared';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-md bg-hearth-500 px-4 py-2.5 text-white shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl rounded-bl-md bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100">
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
      </div>
    </div>
  );
}
