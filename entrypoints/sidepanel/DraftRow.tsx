import { useState } from 'react';
import { locationLabel } from '@/lib/pins';
import type { FeedbackItem } from '@/lib/types';

type Props = {
  item: FeedbackItem;
  number?: number;
  missing: boolean;
  onFocus?: () => void;
  onSave: (comment: string) => void;
  onDelete: () => void;
};

const KIND_LABEL = { element: 'Element', 'text-edit': 'Text', page: 'Page' } as const;

export function DraftRow({ item, number, missing, onFocus, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(item.comment);
  const canSave = item.kind === 'text-edit' || comment.trim() !== '';

  return (
    <li className="row">
      <button type="button" className="row__main" onClick={onFocus} disabled={!onFocus}>
        <span className="badge">{number ?? '•'}</span>
        <span className="row__body">
          <span className="row__meta">
            {KIND_LABEL[item.kind]} · {locationLabel(item)}
          </span>
          {item.textEdit && (
            <span className="row__edit">
              “{item.textEdit.before}” → “{item.textEdit.after}”
            </span>
          )}
          {!editing && item.comment && <span className="row__comment">{item.comment}</span>}
          {missing && <span className="row__warning">element not found</span>}
        </span>
      </button>

      {editing ? (
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
      ) : (
        <div className="row__actions">
          <button
            type="button"
            onClick={() => {
              setComment(item.comment);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
