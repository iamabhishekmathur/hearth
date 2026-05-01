import { useEffect, useRef, useCallback, useState } from 'react';
import type { Artifact } from '@/hooks/use-artifacts';
import { ArtifactContent } from './artifact-content';

interface ArtifactDrawerProps {
  artifact: Artifact;
  onClose: () => void;
}

export function ArtifactDrawer({ artifact, onClose }: ArtifactDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [startY, setStartY] = useState<number | null>(null);
  const [translateY, setTranslateY] = useState(0);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (startY === null) return;
      const diff = e.touches[0].clientY - startY;
      if (diff > 0) {
        setTranslateY(diff);
      }
    },
    [startY],
  );

  const handleTouchEnd = useCallback(() => {
    if (translateY > 100) {
      onClose();
    }
    setTranslateY(0);
    setStartY(null);
  }, [translateY, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col rounded-t-2xl bg-hearth-card shadow-hearth-4 animate-scale-in"
        style={{ transform: `translateY(${translateY}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center py-2">
          <div className="h-1 w-10 rounded-full bg-hearth-border-strong" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-hearth-border px-4 pb-2">
          <h3 className="truncate text-sm font-medium text-hearth-text">{artifact.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-hearth-text-faint hover:text-hearth-text-muted"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-4 py-4">
          <ArtifactContent artifact={artifact} />
        </div>
      </div>
    </>
  );
}
