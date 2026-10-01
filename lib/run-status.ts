export type RunTone = 'pending' | 'running' | 'done' | 'failed';

const FINISHED: ReadonlySet<string> = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);

export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}

function inWords(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The chip for a feedback run. `status` is undefined until Auto Agent lists the run;
 * `requiresApproval` comes from creating it and matters only until the run starts.
 */
export function runStatus(status: string | undefined, requiresApproval: boolean): { label: string; tone: RunTone } {
  switch (status) {
    case 'SUCCESS':
      return { label: 'Done', tone: 'done' };
    case 'FAILED':
      return { label: 'Failed', tone: 'failed' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'failed' };
    case 'RUNNING':
      return { label: 'Running', tone: 'running' };
    case undefined:
    case 'PENDING':
      return requiresApproval
        ? { label: 'Waiting for approval', tone: 'pending' }
        : { label: 'Queued', tone: 'pending' };
    default:
      return { label: inWords(status), tone: 'running' };
  }
}
