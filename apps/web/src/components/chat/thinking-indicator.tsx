interface ThinkingIndicatorProps {
  content?: string | null;
}

export function ThinkingIndicator({ content }: ThinkingIndicatorProps) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
        {content ? (
          <p className="text-sm italic text-gray-500">{content}</p>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 animate-bounce rounded-full bg-hearth-400 [animation-delay:0ms]" />
            <div className="h-2 w-2 animate-bounce rounded-full bg-hearth-400 [animation-delay:150ms]" />
            <div className="h-2 w-2 animate-bounce rounded-full bg-hearth-400 [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
