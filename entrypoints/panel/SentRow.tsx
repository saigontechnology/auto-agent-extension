import { TextChange } from '@/components/TextChange';
import { useState } from 'react';
import { flowSummary } from '@/lib/flow/step-label';
import type { FlowStep, SentFeedback } from '@/lib/types';
import { FlowSteps } from './FlowSteps';
import { Icon, IconButton } from './icons';
import { PageLink } from './PageLink';

type Props = {
  item: SentFeedback;
  number?: number;
  missing: boolean;
  onFocus?: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onGoTo?: (step: FlowStep) => void;
  missingSteps?: ReadonlySet<string>;
};

export function SentRow({ item, number, missing, onFocus, onResolve, onReopen, onGoTo, missingSteps }: Props) {
  const [open, setOpen] = useState(false);
  const flow = item.kind === 'flow' ? item.flow : undefined;
  const resolved = item.status === 'resolved';

  return (
    <li className={resolved ? 'row row--resolved' : 'row'}>
      <button type="button" className="row__main" onClick={onFocus} disabled={!onFocus}>
        {resolved ? (
          <span className="badge badge--resolved" aria-label="Resolved">
            <Icon name="resolve" />
          </span>
        ) : (
          <span className="badge badge--sent">{number}</span>
        )}
        <span className="row__body">
          {item.textEdit && <TextChange className="row__edit" {...item.textEdit} />}
          {item.comment && <span className="row__comment">{item.comment}</span>}
          {flow && <span className="row__meta">{flowSummary(flow.steps)}</span>}
          {missing && <span className="row__warning">element not found</span>}
        </span>
      </button>

      <div className="row__tools">
        {resolved ? (
          <IconButton icon="reopen" label="Reopen" onClick={onReopen} />
        ) : (
          <IconButton icon="resolve" label="Resolve" tone="confirm" onClick={onResolve} />
        )}
      </div>

      {flow && (
        <div className="row__flow">
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide steps' : 'Show steps'}
          </button>
          {open && (
            <FlowSteps steps={flow.steps} failedStepId={flow.failedStepId} missing={missingSteps} onGoTo={onGoTo} />
          )}
        </div>
      )}

      <PageLink page={item.page} />
    </li>
  );
}
