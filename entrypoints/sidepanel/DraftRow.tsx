import { useState } from 'react';
import { TextChange } from '@/components/TextChange';
import type { FeedbackItem } from '@/lib/types';
import { IconButton } from './icons';
import { PageLink } from './PageLink';

type Props = {
  item: FeedbackItem;
  number?: number;
  missing: boolean;
  onFocus?: () => void;
  onSave: (comment: string) => void;
  onDelete: () => void;
};

export function DraftRow({ item, number, missing, onFocus, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(item.comment);
  const canSave = item.kind === 'text-edit' || comment.trim() !== '';

  return (
    <li className="row">
      <button type="button" className="row__main" onClick={onFocus} disabled={!onFocus}>
        <span className={number === undefined ? 'badge badge--blank' : 'badge'}>{number}</span>
        <span className="row__body">
          {item.textEdit && <TextChange className="row__edit" {...item.textEdit} />}
          {!editing && item.comment && <span className="row__comment">{item.comment}</span>}
          {missing && <span className="row__warning">element not found</span>}
        </span>
      </button>

      {!editing && (
        <div className="row__tools">
          <IconButton
            icon="edit"
            label="Edit"
            onClick={() => {
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
