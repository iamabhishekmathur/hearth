import { useState, useEffect } from 'react';
import type { Routine } from '@hearth/shared';
import { useRoutines } from '@/hooks/use-routines';
import { RoutineList } from '@/components/routines/routine-list';
import { RoutineForm } from '@/components/routines/routine-form';
import { RoutineDetail } from '@/components/routines/routine-detail';
import { RoutineTemplateBrowser } from '@/components/routines/routine-templates';
import type { RoutineTemplate } from '@/components/routines/routine-templates';

type View = 'list' | 'templates';

export function RoutinesPage() {
  const {
    routines, loading, fetchRoutines,
    createRoutine, updateRoutine, deleteRoutine,
    toggleRoutine, runNow, fetchRuns,
  } = useRoutines();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Routine | null>(null);
  const [view, setView] = useState<View>('list');
  const [prefill, setPrefill] = useState<{
    name: string;
    description: string;
    prompt: string;
    schedule: string;
  } | null>(null);

  useEffect(() => {
    fetchRoutines();
  }, [fetchRoutines]);

  const handleTemplateSelect = (template: RoutineTemplate) => {
    setPrefill({
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      schedule: template.schedule,
    });
    setView('list');
    setShowCreate(true);
    setSelected(null);
  };

  const handleCreateSubmit = async (data: {
    name: string;
    description?: string;
    prompt: string;
    schedule: string;
    delivery?: Record<string, unknown>;
  }) => {
    await createRoutine(data);
    setShowCreate(false);
    setPrefill(null);
    fetchRoutines();
  };

  const handleCreateCancel = () => {
    setShowCreate(false);
    setPrefill(null);
  };

  // Template browser view
  if (view === 'templates') {
    return (
      <div className="flex h-full flex-col">
        <RoutineTemplateBrowser
          onSelect={handleTemplateSelect}
          onClose={() => setView('list')}
        />
      </div>
    );
  }

  // Empty state — show templates directly
  if (!loading && routines.length === 0 && !showCreate) {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Routines</h1>
            <p className="mt-0.5 text-sm text-gray-500">Scheduled agent automations</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700"
          >
            New Routine
          </button>
        </div>

        {/* Empty state with inline template browser */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-hearth-50">
            <svg className="h-7 w-7 text-hearth-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Get started with a template</h2>
          <p className="mt-1 max-w-md text-center text-sm text-gray-500">
            Pick a template below to quick-start a routine, or create one from scratch.
          </p>

          <div className="mt-6 w-full max-w-3xl">
            <RoutineTemplateBrowser onSelect={handleTemplateSelect} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Routines</h1>
          <p className="mt-0.5 text-sm text-gray-500">Scheduled agent automations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setView('templates'); setSelected(null); }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Browse Templates
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(true); setSelected(null); setPrefill(null); }}
            className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700"
          >
            New Routine
          </button>
        </div>
      </div>

      {/* Scrollable body below the header */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Create form (inline bar) */}
        {showCreate && (
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {prefill ? `Create from template: ${prefill.name}` : 'Create Routine'}
              </h2>
              {prefill && (
                <button
                  type="button"
                  onClick={() => setPrefill(null)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear template
                </button>
              )}
            </div>
            <RoutineForm
              initial={prefill ?? undefined}
              onSubmit={handleCreateSubmit}
              onCancel={handleCreateCancel}
            />
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-hearth-600" />
              <p className="mt-3 text-sm text-gray-400">Loading routines...</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* List */}
            <div className={`flex-1 p-4 ${selected ? 'hidden md:block' : ''}`}>
              <RoutineList
                routines={routines}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onToggle={async (id) => {
                  await toggleRoutine(id);
                  fetchRoutines();
                }}
                onRunNow={async (id) => {
                  await runNow(id);
                }}
              />
            </div>

            {/* Detail panel (slide-over) */}
            {selected && (
              <div className="w-full border-l border-gray-200 bg-white md:w-[420px] md:min-w-[420px]">
                <div className="h-full overflow-y-auto">
                  <RoutineDetail
                    routine={selected}
                    onUpdate={async (id, data) => {
                      await updateRoutine(id, data);
                      fetchRoutines();
                    }}
                    onDelete={async (id) => {
                      await deleteRoutine(id);
                      setSelected(null);
                      fetchRoutines();
                    }}
                    onRunNow={async (id) => {
                      await runNow(id);
                    }}
                    fetchRuns={fetchRuns}
                    onClose={() => setSelected(null)}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
