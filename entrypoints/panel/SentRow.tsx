import { TextChange } from '@/components/TextChange';
import type { SentFeedback } from '@/lib/types';
import { Icon, IconButton } from './icons';
import { PageLink } from './PageLink';

type Props = {
  item: SentFeedback;
  number?: number;
  missing: boolean;
  onFocus?: () => void;
  onResolve: () => void;
  onReopen: () => void;
};

export function SentRow({ item, number, missing, onFocus, onResolve, onReopen }: Props) {
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

      <PageLink page={item.page} />
    </li>
  );
}
