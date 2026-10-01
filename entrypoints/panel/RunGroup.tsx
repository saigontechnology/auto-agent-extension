import type { ReactNode } from 'react';
import { WEB_BASE } from '@/lib/config';
import { runStatus } from '@/lib/run-status';
import type { SentGroup } from '@/lib/sent-groups';

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One feedback run: when it was sent, how it is going, and the items that went out in it. */
export function RunGroup({ group, children }: { group: SentGroup; children: ReactNode }) {
  const status = group.runId ? runStatus(group.status, group.requiresApproval) : null;
  return (
    <li className="run">
      <div className="run__heading">
        <span className="run__title">
          {group.runId ? `Sent ${formatSentAt(group.sentAt)}` : 'Sent earlier'}
          {group.createdBy && <span className="muted"> by {group.createdBy}</span>}
        </span>
        {status && <span className={`chip chip--${status.tone}`}>{status.label}</span>}
        {group.runId && (
          <a className="run__link" href={`${WEB_BASE}/jobs/${group.runId}`} target="_blank" rel="noreferrer">
            Open in Auto Agent
          </a>
        )}
      </div>
      {group.items.length > 0 && <ul>{children}</ul>}
    </li>
  );
}
