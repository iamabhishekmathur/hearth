import { useState } from 'react';
import { api } from '@/lib/api-client';

type Cadence = 'morning_digest' | '24h_before' | '1h_before' | 'realtime' | 'off';

const CADENCE_OPTIONS: { value: Cadence; label: string; description: string }[] = [
  { value: 'morning_digest', label: 'Morning Digest', description: 'Get all prep materials at 9am' },
  { value: '24h_before', label: '24 hours before', description: 'Nudge sent 24 hours before each meeting' },
  { value: '1h_before', label: '1 hour before', description: 'Nudge sent 1 hour before each meeting' },
  { value: 'realtime', label: 'Real-time', description: 'Nudge as meeting approaches (15 min)' },
  { value: 'off', label: 'Off', description: 'No meeting prep nudges' },
];

interface MeetingPrepSettingsProps {
  currentCadence: Cadence;
  onUpdate: () => void;
}

export function MeetingPrepSettings({ currentCadence, onUpdate }: MeetingPrepSettingsProps) {
  const [cadence, setCadence] = useState<Cadence>(currentCadence);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/me', {
        preferences: { meetingPrepCadence: cadence },
      });
      onUpdate();
    } catch {
      // Handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-hearth-text">Meeting Prep Cadence</h3>
        <p className="mt-0.5 text-xs text-hearth-text-muted">
          Choose when to receive proactive meeting preparation suggestions
        </p>
      </div>

      <div role="radiogroup" aria-label="Meeting prep cadence" className="space-y-2">
        {CADENCE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              cadence === option.value ? 'border-hearth-300 bg-hearth-50' : 'border-hearth-border hover:bg-hearth-bg'
            }`}
          >
            <input
              type="radio"
              name="meetingPrepCadence"
              value={option.value}
              checked={cadence === option.value}
              onChange={() => setCadence(option.value)}
              className="mt-0.5 text-hearth-600 focus:ring-hearth-accent"
            />
            <div>
              <p className="text-sm font-medium text-hearth-text">{option.label}</p>
              <p className="text-xs text-hearth-text-muted">{option.description}</p>
            </div>
          </label>
        ))}
      </div>

      {cadence !== currentCadence && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}
    </div>
  );
}
