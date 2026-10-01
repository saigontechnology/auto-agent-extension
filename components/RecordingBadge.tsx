import type { RecordingState } from '@/lib/flow/types';

/** Tells the reviewer the tab is being recorded, even with the panel folded or closed. */
export function RecordingBadge({ state }: { state: RecordingState }) {
  if (state.status !== 'recording' && state.status !== 'paused') return null;
  const paused = state.status === 'paused';
  return (
    <div className={paused ? 'vf-rec vf-rec--paused' : 'vf-rec'} role="status">
      <span className="vf-rec__dot" aria-hidden="true" />
      {paused ? 'Paused' : 'REC'} · {state.steps}
    </div>
  );
}
