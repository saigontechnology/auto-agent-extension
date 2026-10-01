import { useState } from 'react';
import type { FlowEdits } from '@/lib/flow/types';
import type { FlowStep } from '@/lib/types';
import { FlowSteps } from './FlowSteps';

type Props = {
  heading: string;
  initial: FlowEdits;
  notice?: string;
  missing?: ReadonlySet<string>;
  cancelLabel: string;
  /** Asks before cancelling, because cancelling throws the recording away. */
  confirmCancel: boolean;
  /** True while a save or discard is on its way, so it cannot be sent twice. */
  busy?: boolean;
  onHoverStep: (step: FlowStep | null) => void;
  onSave: (edits: FlowEdits) => void;
  onCancel: () => void;
};

export function FlowReview({
  heading,
  initial,
  notice,
  missing,
  cancelLabel,
  confirmCancel,
  busy = false,
  onHoverStep,
  onSave,
  onCancel,
}: Props) {
  const [edits, setEdits] = useState<FlowEdits>(initial);
  const [confirming, setConfirming] = useState(false);
  const canSave = edits.title.trim() !== '';

  const setField = (field: 'title' | 'expected' | 'actual', value: string) =>
    setEdits((current) => ({ ...current, [field]: value }));

  const flag = (id: string) =>
    setEdits(({ failedStepId, ...rest }) => (failedStepId === id ? rest : { ...rest, failedStepId: id }));

  const remove = (id: string) =>
    setEdits(({ failedStepId, steps, ...rest }) => ({
      ...rest,
      ...(failedStepId && failedStepId !== id ? { failedStepId } : {}),
      steps: steps.filter((step) => step.id !== id),
    }));

  const change = (changed: FlowStep) =>
    setEdits((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === changed.id ? changed : step)),
    }));

  return (
    <form
      className="review"
      aria-label="Review workflow"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !busy) onSave({ ...edits, title: edits.title.trim() });
      }}
    >
      <h2>{heading}</h2>
      {notice && <p className="notice">{notice}</p>}

      <label className="field">
        <span>Title</span>
        <input
          autoFocus
          value={edits.title}
          placeholder="What goes wrong, in a few words"
          onChange={(event) => setField('title', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Expected</span>
        <textarea
          value={edits.expected}
          placeholder="What should happen"
          onChange={(event) => setField('expected', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Actual</span>
        <textarea
          value={edits.actual}
          placeholder="What happens instead"
          onChange={(event) => setField('actual', event.target.value)}
        />
      </label>

      <h3 className="review__steps">Steps ({edits.steps.length})</h3>
      <FlowSteps
        steps={edits.steps}
        failedStepId={edits.failedStepId}
        missing={missing}
        onHover={onHoverStep}
        onFlag={flag}
        onDelete={remove}
        onChange={change}
      />

      {confirming ? (
        <div className="review__confirm" role="alert">
          <span>Discard this recording? Its steps will be lost.</span>
          <div className="row__actions">
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="button" className="danger" disabled={busy} onClick={onCancel}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <div className="review__actions">
          <button type="button" disabled={busy} onClick={() => (confirmCancel ? setConfirming(true) : onCancel())}>
            {cancelLabel}
          </button>
          <button type="submit" className="primary" disabled={!canSave || busy}>
            Save draft
          </button>
        </div>
      )}
    </form>
  );
}
