import type { FeedbackRun } from './api/auto-agent-client';
import { isFinished } from './run-status';
import type { SentFeedback } from './types';

export type SentGroup = {
  key: string;
  /** Null for items sent before the extension was connected to Auto Agent. */
  runId: string | null;
  sentAt: string;
  /** Undefined until Auto Agent lists the run. */
  status: string | undefined;
  requiresApproval: boolean;
  /** Set for runs this browser has no items for: someone else's, or sent from another page. */
  createdBy: string | null;
  items: SentFeedback[];
};

/** Sent items grouped by the run they went out in, newest run first, plus the demo's other runs. */
export function groupSent(sent: SentFeedback[], runs: FeedbackRun[]): SentGroup[] {
  const byRun = new Map<string, SentGroup>();
  const earlier: SentFeedback[] = [];
  for (const item of sent) {
    if (!item.run) {
      earlier.push(item);
      continue;
    }
    const group = byRun.get(item.run.jobId) ?? {
      key: item.run.jobId,
      runId: item.run.jobId,
      sentAt: item.run.sentAt,
      status: undefined,
      requiresApproval: item.run.requiresApproval,
      createdBy: null,
      items: [],
    };
    group.items.push(item);
    byRun.set(item.run.jobId, group);
  }
  for (const run of runs) {
    const group = byRun.get(run.id);
    if (group) {
      group.status = run.status;
    } else {
      byRun.set(run.id, {
        key: run.id,
        runId: run.id,
        sentAt: run.createdAt,
        status: run.status,
        requiresApproval: false,
        createdBy: run.createdBy,
        items: [],
      });
    }
  }
  const groups = [...byRun.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  if (earlier.length > 0) {
    groups.push({
      key: 'earlier',
      runId: null,
      sentAt: '',
      status: undefined,
      requiresApproval: false,
      createdBy: null,
      items: earlier,
    });
  }
  return groups;
}

/** True while a run on `demoJobId` may still change, so its status is worth asking for again. */
export function hasUnfinishedRuns(sent: SentFeedback[], runs: FeedbackRun[], demoJobId: string): boolean {
  if (runs.some((run) => !isFinished(run.status))) return true;
  const listed = new Set(runs.map((run) => run.id));
  return sent.some((item) => item.run?.demoJobId === demoJobId && !listed.has(item.run.jobId));
}
