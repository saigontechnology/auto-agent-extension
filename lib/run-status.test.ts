import { describe, expect, it } from 'vitest';
import { isFinished, runStatus } from './run-status';

describe('run status', () => {
  it('knows which statuses are final', () => {
    expect(['SUCCESS', 'FAILED', 'CANCELLED'].every(isFinished)).toBe(true);
    expect(isFinished('RUNNING')).toBe(false);
  });

  it('labels each status for the chip', () => {
    expect(runStatus('SUCCESS', false)).toEqual({ label: 'Done', tone: 'done' });
    expect(runStatus('FAILED', false)).toEqual({ label: 'Failed', tone: 'failed' });
    expect(runStatus('CANCELLED', false)).toEqual({ label: 'Cancelled', tone: 'failed' });
    expect(runStatus('RUNNING', true)).toEqual({ label: 'Running', tone: 'running' });
    expect(runStatus('PENDING', false)).toEqual({ label: 'Queued', tone: 'pending' });
    expect(runStatus(undefined, false)).toEqual({ label: 'Queued', tone: 'pending' });
  });

  it('shows approval only while the run has not started', () => {
    expect(runStatus(undefined, true)).toEqual({ label: 'Waiting for approval', tone: 'pending' });
    expect(runStatus('PENDING', true)).toEqual({ label: 'Waiting for approval', tone: 'pending' });
  });

  it('shows an unknown status in words', () => {
    expect(runStatus('AWAITING_REVIEW', false)).toEqual({ label: 'Awaiting review', tone: 'running' });
  });
});
