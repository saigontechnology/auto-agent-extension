import { useState } from 'react';
import { errorCount, formatElapsed } from '@/lib/flow/step-label';
import type { Recording } from '@/lib/flow/types';
import { FlowSteps } from './FlowSteps';
import { useNow } from './flow-hooks';

type Props = {
  recording: Recording;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onNote: (text: string) => void;
};

export function RecordingBar({ recording, onPause, onResume, onStop, onNote }: Props) {
  const now = useNow(1000);
  const [note, setNote] = useState<string | null>(null);
  const paused = recording.status === 'paused';
  const left = paused && recording.pausedReason === 'left';
  const count = recording.steps.length;
  const errors = errorCount(recording.steps);

  const addNote = () => {
    const text = note?.trim();
    if (!text) return;
    onNote(text);
    setNote(null);
  };

  return (
    <section className="recording" aria-label="Recording">
      <div className="recording__bar">
        <span className={paused ? 'recording__dot recording__dot--paused' : 'recording__dot'} aria-hidden="true" />
        <span className="recording__stats">
          {formatElapsed(now - Date.parse(recording.startedAt))} · {count} {count === 1 ? 'step' : 'steps'} ·{' '}
          {errors} {errors === 1 ? 'error' : 'errors'}
        </span>
        <div className="recording__buttons">
          {!paused && (
            <button type="button" onClick={onPause}>
              Pause
            </button>
          )}
          {paused && !left && (
            <button type="button" onClick={onResume}>
              Resume
            </button>
          )}
          <button type="button" onClick={() => setNote((current) => current ?? '')}>
            Note
          </button>
          <button type="button" className="primary" onClick={onStop}>
            Stop
          </button>
        </div>
      </div>

      {left && <p className="notice">Paused — outside the preview. Recording resumes when you come back.</p>}

      {note !== null && (
        <form
          className="recording__note"
          onSubmit={(event) => {
            event.preventDefault();
            addNote();
          }}
        >
          <input
            autoFocus
            aria-label="Note"
            placeholder="What do you notice here?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="button" onClick={() => setNote(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={note.trim() === ''}>
            Add note
          </button>
        </form>
      )}

      {count === 0 ? (
        <p className="empty">Use the page as usual. Every click, entry and page change is listed here.</p>
      ) : (
        <FlowSteps steps={recording.steps} live />
      )}
    </section>
  );
}
