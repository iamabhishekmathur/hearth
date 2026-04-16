import { useState, useCallback } from 'react';
import type { TaskComment } from '@hearth/shared';

interface TaskCommentsProps {
  comments: TaskComment[];
  onAddComment: (content: string) => Promise<void>;
}

export function TaskComments({ comments, onAddComment }: TaskCommentsProps) {
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddComment(newComment);
      setNewComment('');
    } finally {
      setSubmitting(false);
    }
  }, [newComment, submitting, onAddComment]);

  return (
    <div className="flex h-full flex-col">
      {/* Comments list */}
      <div className="flex-1 space-y-3">
        {comments.length === 0 ? (
          <p className="text-center text-xs text-gray-400 py-4">No comments yet</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="rounded-lg bg-gray-50 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-medium text-gray-700">
                  {comment.isAgent ? 'Agent' : (comment as unknown as { user?: { name: string } }).user?.name ?? 'User'}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
                {comment.isAgent && (
                  <span className="rounded bg-purple-100 px-1 py-0.5 text-xs text-purple-600">
                    AI
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-900">{comment.content}</p>
            </div>
          ))
        )}
      </div>

      {/* New comment */}
      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Add a comment..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-hearth-600 px-3 py-1.5 text-sm text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
