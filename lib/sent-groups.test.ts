import { describe, expect, it } from 'vitest';
import type { FeedbackRun } from './api/auto-agent-client';
import { groupSent, hasUnfinishedRuns } from './sent-groups';
import { makeSent } from './test-helpers';

function run(id: string, status: string, createdAt: string, createdBy = 'bob'): FeedbackRun {
  return { id, status, createdAt, completedAt: null, feedbackDescription: null, feedbackFiles: [], createdBy };
}

const mine = (id: string, runId: string, sentAt: string) =>
  makeSent({ id, run: { jobId: runId, demoJobId: 'job-1', sentAt, requiresApproval: false } });

describe('groupSent', () => {
  it('groups items by run, newest first, with the status from Auto Agent', () => {
    const groups = groupSent(
      [
        mine('a', 'run-1', '2026-10-01T01:00:00Z'),
        mine('b', 'run-1', '2026-10-01T01:00:00Z'),
        mine('c', 'run-2', '2026-10-01T02:00:00Z'),
      ],
      [run('run-1', 'SUCCESS', '2026-10-01T01:00:01Z'), run('run-2', 'RUNNING', '2026-10-01T02:00:01Z')],
    );
    expect(groups.map((group) => [group.runId, group.status, group.items.map((item) => item.id)])).toEqual([
      ['run-2', 'RUNNING', ['c']],
      ['run-1', 'SUCCESS', ['a', 'b']],
    ]);
    expect(groups[0]!.createdBy).toBeNull();
  });

  it('adds runs sent by others, or from elsewhere, as groups without items', () => {
    const groups = groupSent([], [run('run-9', 'RUNNING', '2026-10-01T03:00:00Z', 'carol')]);
    expect(groups).toEqual([
      {
        key: 'run-9',
        runId: 'run-9',
        sentAt: '2026-10-01T03:00:00Z',
        status: 'RUNNING',
        requiresApproval: false,
        createdBy: 'carol',
        items: [],
      },
    ]);
  });

  it('keeps items sent before Auto Agent was connected in a last group', () => {
    const groups = groupSent([makeSent({ id: 'old' }), mine('a', 'run-1', '2026-10-01T01:00:00Z')], []);
    expect(groups.map((group) => group.key)).toEqual(['run-1', 'earlier']);
    expect(groups[1]!.items.map((item) => item.id)).toEqual(['old']);
  });
});

describe('hasUnfinishedRuns', () => {
  it('is true while a run of this demo is not final, including one Auto Agent has not listed yet', () => {
    expect(hasUnfinishedRuns([], [run('r', 'RUNNING', 'x')], 'job-1')).toBe(true);
    expect(hasUnfinishedRuns([mine('a', 'run-new', 'x')], [], 'job-1')).toBe(true);
    expect(hasUnfinishedRuns([mine('a', 'run-1', 'x')], [run('run-1', 'SUCCESS', 'x')], 'job-1')).toBe(false);
  });

  it('ignores items sent to another demo', () => {
    expect(hasUnfinishedRuns([mine('a', 'run-new', 'x')], [], 'job-2')).toBe(false);
  });
});
