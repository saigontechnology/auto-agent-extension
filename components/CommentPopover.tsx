import { useState } from 'react';
import { popoverPosition } from '@/lib/popover-position';

type Props = {
  anchorRect: { top: number; bottom: number; left: number };
  title: string;
  detail?: string;
  initial: string;
  allowEmpty: boolean;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
};

export function CommentPopover(props: Props) {
  const { anchorRect, title, detail, initial, allowEmpty, onSave, onCancel, onDelete } = props;
  const [comment, setComment] = useState(initial);
  const canSave = allowEmpty || comment.trim() !== '';
  const position = popoverPosition(anchorRect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const save = () => {
    if (canSave) onSave(comment);
  };

  return (
    <form
      className="vf-popover"
      style={position}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
      }}
    >
      <div className="vf-popover__title">{title}</div>
      {detail && <div className="vf-popover__detail">{detail}</div>}
      <textarea
        autoFocus
        className="vf-popover__input"
        placeholder={allowEmpty ? 'Add a note (optional)' : 'Add a comment'}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="vf-popover__actions">
        {onDelete && (
          <button type="button" className="vf-button vf-button--danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <span className="vf-popover__spacer" />
        <button type="button" className="vf-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="vf-button vf-button--primary" disabled={!canSave}>
          Save
        </button>
      </div>
    </form>
  );
}
