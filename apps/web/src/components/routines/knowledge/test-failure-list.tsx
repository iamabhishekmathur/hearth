import type { RoutineTestFailure } from '@hearth/shared';

/** Why a change was blocked: one line per test case it breaks. */
export function TestFailureList({ failures }: { failures: RoutineTestFailure[] }) {
  return (
    <div role="alert" className="text-xs">
      <p className="font-medium text-hearth-text">
        This change breaks {failures.length === 1 ? 'a test case' : `${failures.length} test cases`}
        :
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-hearth-text-muted">
        {failures.map((f) => (
          <li key={f.testCaseId}>
            <span className="text-hearth-text">{f.description}</span> — {f.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
