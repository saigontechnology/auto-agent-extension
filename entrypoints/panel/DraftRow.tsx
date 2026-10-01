import { useState } from 'react';
import { TextChange } from '@/components/TextChange';
import { isSendable } from '@/lib/flow/flow-item';
import { flowSummary } from '@/lib/flow/step-label';
import type { FeedbackItem } from '@/lib/types';
import { Checkbox } from './Checkbox';
import { Icon, IconButton } from './icons';
import { PageLink } from './PageLink';

type Props = {
  item: FeedbackItem;
  number?: number;
  missing: boolean;
  /** Whether the next Send includes this draft. */
  included: boolean;
  onInclude: (included: boolean) => void;
  onFocus?: () => void;
  onEditFlow?: () => void;
  onSave: (comment: string) => void;
  onDelete: () => void;
};

export function DraftRow({
  item,
  number,
  missing,
  included,
  onInclude,
  onFocus,
  onEditFlow,
  onSave,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(item.comment);
  const canSave = item.kind === 'text-edit' || comment.trim() !== '';
  const flow = item.kind === 'flow' ? item.flow : undefined;
  const sendable = isSendable(item);

  return (
    <li className={included && sendable ? 'row row--draft' : 'row row--draft row--excluded'}>
      <Checkbox
        checked={included && sendable}
        disabled={!sendable}
        label="Include in send"
        onChange={onInclude}
      />
      <button type="button" className="row__main" onClick={onFocus} disabled={!onFocus}>
        {flow ? (
          <span className="badge badge--flow" aria-label="Workflow">
            <Icon name="workflow" />
          </span>
        ) : (
          <span className={number === undefined ? 'badge badge--blank' : 'badge'}>{number}</span>
        )}
        <span className="row__body">
          {flow ? (
            <>
              <span className="row__comment">{item.comment || <em>Untitled workflow</em>}</span>
              <span className="row__meta">{flowSummary(flow.steps)}</span>
              {!sendable && <span className="row__warning">Add a title to send</span>}
            </>
          ) : (
            <>
              {item.textEdit && <TextChange className="row__edit" {...item.textEdit} />}
              {!editing && item.comment && <span className="row__comment">{item.comment}</span>}
              {missing && <span className="row__warning">element not found</span>}
            </>
          )}
        </span>
      </button>

      {!editing && (
        <div className="row__tools">
          <IconButton
            icon="edit"
            label="Edit"
            onClick={() => {
              if (flow) {
                onEditFlow?.();
                return;
              }
              setComment(item.comment);
              setEditing(true);
            }}
          />
          <IconButton icon="delete" label="Delete" tone="danger" onClick={onDelete} />
        </div>
      )}

      <PageLink page={item.page} />

      {editing && (
        <form
          className="row__editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onSave(comment.trim());
            setEditing(false);
          }}
        >
          <textarea value={comment} autoFocus onChange={(event) => setComment(event.target.value)} />
          <div className="row__actions">
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canSave}>
              Save
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
