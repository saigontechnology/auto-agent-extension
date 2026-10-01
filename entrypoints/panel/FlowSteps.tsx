import { useEffect, useRef, useState } from 'react';
import { withValue } from '@/lib/flow/flow-item';
import { editableValue, stepAnchor, stepLabel, stepTone } from '@/lib/flow/step-label';
import type { FlowStep } from '@/lib/types';
import { IconButton } from './icons';

type Props = {
  steps: FlowStep[];
  failedStepId?: string;
  /** Ids of steps whose element could not be found on the page. */
  missing?: ReadonlySet<string>;
  /** The live list while recording: fixed height, kept scrolled to the newest step. */
  live?: boolean;
  onHover?: (step: FlowStep | null) => void;
  onFlag?: (id: string) => void;
  onDelete?: (id: string) => void;
  onChange?: (step: FlowStep) => void;
  onGoTo?: (step: FlowStep) => void;
};

/** One list for the live recording, the review screen and sent workflows; tools appear per handler. */
export function FlowSteps({ steps, failedStepId, missing, live, onHover, onFlag, onDelete, onChange, onGoTo }: Props) {
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Scrolls the list itself; scrollIntoView could also scroll the page around the panel.
  useEffect(() => {
    const list = listRef.current;
    if (live && list) list.scrollTop = list.scrollHeight;
  }, [live, steps.length]);

  const saveEdit = (step: FlowStep) => {
    if (editing && onChange) onChange(withValue(step, editing.value));
    setEditing(null);
  };

  return (
    <ol ref={listRef} className={live ? 'steps steps--live' : 'steps'}>
      {steps.map((step, index) => {
        const label = stepLabel(step);
        const tone = stepTone(step);
        const failed = step.id === failedStepId;
        const value = editableValue(step);
        const classes = ['step', tone && `step--${tone}`, failed && 'step--failed'].filter(Boolean).join(' ');
        return (
          <li
            key={step.id}
            className={classes}
            onMouseEnter={onHover ? () => onHover(step) : undefined}
            onMouseLeave={onHover ? () => onHover(null) : undefined}
          >
            <span className="step__number">{index + 1}</span>
            <span className="step__body">
              <span className="step__text">{label.text}</span>
              {label.source && <span className="step__source">{label.source}</span>}
              {failed && <span className="step__flag">Fails here</span>}
              {missing?.has(step.id) && <span className="row__warning">element not found</span>}
            </span>
            <span className="step__tools">
              {onGoTo && stepAnchor(step) && <IconButton icon="goto" label="Go to" onClick={() => onGoTo(step)} />}
              {onFlag && (
                <IconButton
                  icon="flag"
                  label={failed ? 'Clear failing step' : 'Mark as failing step'}
                  tone={failed ? 'confirm' : undefined}
                  onClick={() => onFlag(step.id)}
                />
              )}
              {onChange && value !== null && (
                <IconButton icon="edit" label="Edit step" onClick={() => setEditing({ id: step.id, value })} />
              )}
              {onDelete && <IconButton icon="delete" label="Delete step" tone="danger" onClick={() => onDelete(step.id)} />}
            </span>
            {editing?.id === step.id && (
              // Not a form: the list sits inside the review form, and forms cannot nest.
              <div className="step__editor">
                <input
                  autoFocus
                  aria-label="Step value"
                  value={editing.value}
                  onChange={(event) => setEditing({ id: step.id, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveEdit(step);
                    } else if (event.key === 'Escape') {
                      setEditing(null);
                    }
                  }}
                />
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className="primary" onClick={() => saveEdit(step)}>
                  Save
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
