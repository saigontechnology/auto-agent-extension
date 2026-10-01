import type { PageRef } from '@/lib/types';
import { Icon } from './icons';

/** The page a feedback item was left on, opening in a new tab. */
export function PageLink({ page }: { page: PageRef }) {
  const { host } = new URL(page.url);
  return (
    <a className="row__link" href={page.url} target="_blank" rel="noreferrer" title={page.url}>
      <span>
        {host}
        {page.path}
      </span>
      <Icon name="external" />
    </a>
  );
}
