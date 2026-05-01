import { useState, useEffect } from 'react';
import type { Routine, RoutineScope } from '@hearth/shared';
import { useRoutines } from '@/hooks/use-routines';
import { RoutineList } from '@/components/routines/routine-list';
import { RoutineForm } from '@/components/routines/routine-form';
import { RoutineDetail } from '@/components/routines/routine-detail';
import { RoutineTemplateBrowser } from '@/components/routines/routine-templates';
import { HButton, HEyebrow } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import type { RoutineTemplate } from '@/components/routines/routine-templates';

type View = 'list' | 'templates';

const scopeTabs: { label: string; value: RoutineScope | undefined }[] = [
  { label: 'My Routines', value: undefined },
  { label: 'Team', value: 'team' },
  { label: 'Organization', value: 'org' },
];

export function RoutinesPage() {
  const {
    routines, loading, fetchRoutines,
    createRoutine, updateRoutine, deleteRoutine,
    toggleRoutine, runNow, fetchRuns,
  } = useRoutines();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Routine | null>(null);
  const [view, setView] = useState<View>('list');
  const [activeScope, setActiveScope] = useState<RoutineScope | undefined>(undefined);
  const [prefill, setPrefill] = useState<{
    name: string;
    description: string;
    prompt: string;
    schedule: string;
  } | null>(null);

  useEffect(() => {
    fetchRoutines(activeScope);
  }, [fetchRoutines, activeScope]);

  // Auto-select routine from URL query param (e.g., ?routineId=abc)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const routineId = params.get('routineId');
    if (routineId && routines.length > 0) {
      const routine = routines.find((r) => r.id === routineId);
      if (routine) setSelected(routine);
    }
  }, [routines]);

  const handleScopeChange = (scope: RoutineScope | undefined) => {
    setActiveScope(scope);
    setSelected(null);
  };

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreateSubmit = async (data: any) => {
    await createRoutine(data);
    setShowCreate(false);
    setPrefill(null);
    fetchRoutines(activeScope);
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
        <div className="flex items-center justify-between border-b border-hearth-border px-6 py-4">
          <div>
            <HEyebrow>Automation</HEyebrow>
            <h1 className="mt-1 font-display text-[22px] font-medium" style={{ letterSpacing: '-0.4px', lineHeight: 1.2 }}>
              Routines<span style={{ color: 'var(--hearth-accent)' }}>.</span>
            </h1>
            <p className="mt-0.5 text-sm text-hearth-text-muted">Scheduled agent automations</p>
          </div>
          <HButton
            variant="accent"
            icon="plus"
            onClick={() => setShowCreate(true)}
          >
            New Routine
          </HButton>
        </div>

        {/* Scope tabs */}
        <div className="border-b border-hearth-border px-6">
          <nav className="-mb-px flex gap-4" aria-label="Routine scope">
            {scopeTabs.map((tab) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => handleScopeChange(tab.value)}
                className={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-all duration-fast ease-hearth ${
                  activeScope === tab.value
                    ? 'border-hearth-accent text-hearth-accent'
                    : 'border-transparent text-hearth-text-muted hover:border-hearth-border-strong hover:text-hearth-text'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Empty state with inline template browser */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--hearth-accent-soft)' }}>
            <HIcon name="clock" size={28} color="var(--hearth-accent)" />
          </div>
          <h2 className="font-display text-lg font-medium text-hearth-text" style={{ letterSpacing: '-0.3px' }}>Get started with a template</h2>
          <p className="mt-1 max-w-md text-center text-sm text-hearth-text-muted">
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
      <div className="flex items-center justify-between border-b border-hearth-border px-6 py-4">
        <div>
          <HEyebrow>Automation</HEyebrow>
          <h1 className="mt-1 font-display text-[22px] font-medium" style={{ letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            Routines<span style={{ color: 'var(--hearth-accent)' }}>.</span>
          </h1>
          <p className="mt-0.5 text-sm text-hearth-text-muted">Scheduled agent automations</p>
        </div>
        <div className="flex items-center gap-2">
          <HButton
            variant="ghost"
            onClick={() => { setView('templates'); setSelected(null); }}
          >
            Browse Templates
          </HButton>
          <HButton
            variant="accent"
            icon="plus"
            onClick={() => { setShowCreate(true); setSelected(null); setPrefill(null); }}
          >
            New Routine
          </HButton>
        </div>
      </div>

      {/* Scope tabs */}
      <div className="border-b border-hearth-border px-6">
        <nav className="-mb-px flex gap-4" aria-label="Routine scope">
          {scopeTabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => handleScopeChange(tab.value)}
              className={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-all duration-fast ease-hearth ${
                activeScope === tab.value
                  ? 'border-hearth-accent text-hearth-accent'
                  : 'border-transparent text-hearth-text-muted hover:border-hearth-border-strong hover:text-hearth-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Scrollable body below the header */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Create form (inline bar) */}
        {showCreate && (
          <div className="border-b border-hearth-border bg-hearth-card-alt px-6 py-4 animate-fade-in">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-hearth-text">
                {prefill ? `Create from template: ${prefill.name}` : 'Create Routine'}
              </h2>
              {prefill && (
                <button
                  type="button"
                  onClick={() => setPrefill(null)}
                  className="text-xs text-hearth-text-muted hover:text-hearth-text"
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
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-hearth-border border-t-hearth-accent" />
              <p className="mt-3 text-sm text-hearth-text-faint">Loading routines...</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* List */}
            <div key={activeScope ?? 'all'} className={`flex-1 p-4 animate-fade-in ${selected ? 'hidden md:block' : ''}`}>
              <RoutineList
                routines={routines}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onToggle={async (id) => {
                  await toggleRoutine(id);
                  fetchRoutines(activeScope);
                }}
                onRunNow={async (id) => {
                  await runNow(id);
                }}
              />
            </div>

            {/* Detail panel (slide-over) */}
            {selected && (
              <div className="w-full border-l border-hearth-border bg-hearth-card md:w-[420px] md:min-w-[420px]">
                <div className="h-full overflow-y-auto">
                  <RoutineDetail
                    routine={selected}
                    onUpdate={async (id, data) => {
                      await updateRoutine(id, data);
                      fetchRoutines(activeScope);
                    }}
                    onDelete={async (id) => {
                      await deleteRoutine(id);
                      setSelected(null);
                      fetchRoutines(activeScope);
                    }}
                    onRunNow={async (id, parameterValues) => {
                      await runNow(id, parameterValues);
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
