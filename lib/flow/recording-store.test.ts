import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clickStep } from '../test-helpers';
import type { PageContext } from '../types';
import {
  getRecording,
  pauseRecording,
  recordStep,
  removeRecording,
  resumeRecording,
  startRecording,
  stopRecording,
  watchRecording,
} from './recording-store';
import { MAX_STEPS } from './steps';

const context: PageContext = {
  projectId: 'proj',
  buildId: 'build_1',
  path: '/login',
  url: 'https://demo.web.app/login',
  title: 'Sign in',
};
const viewport = { width: 1280, height: 720, dpr: 1 };
const now = new Date('2026-10-01T00:00:00.000Z');
const later = new Date('2026-10-01T00:03:00.000Z');

const start = (tabId = 1) => startRecording({ tabId, context, viewport, now });

describe('recording-store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts a recording from the page context', async () => {
    expect(await start()).toEqual({
      tabId: 1,
      projectId: 'proj',
      buildId: 'build_1',
      startPage: { url: context.url, path: '/login', title: 'Sign in' },
      viewport,
      status: 'recording',
      steps: [],
      startedAt: now.toISOString(),
    });
    expect(await getRecording(1)).toMatchObject({ status: 'recording' });
    expect(await getRecording(2)).toBeNull();
  });

  it('returns the existing recording instead of starting over', async () => {
    await start();
    await recordStep(1, clickStep('a'), now);
    await stopRecording(1, later);
    const again = await start();
    expect(again).toMatchObject({ status: 'stopped', steps: [{ id: 'a' }] });
  });

  it('records steps only while recording', async () => {
    expect(await recordStep(1, clickStep('none'), now)).toBeNull();
    await start();
    await recordStep(1, clickStep('a'), now);
    await pauseRecording(1, 'user');
    await recordStep(1, clickStep('paused'), now);
    await resumeRecording(1);
    await recordStep(1, clickStep('b'), now);
    expect((await getRecording(1))?.steps.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('keeps every step when many arrive at once', async () => {
    await start();
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordStep(1, clickStep(`s${i}`), now)));
    expect((await getRecording(1))?.steps).toHaveLength(20);
  });

  it('stops itself at the step limit', async () => {
    await start();
    for (let i = 0; i < MAX_STEPS; i += 1) await recordStep(1, clickStep(`s${i}`), now);
    const stopped = await recordStep(1, clickStep('extra'), later);
    expect(stopped).toMatchObject({ status: 'stopped', limitReached: true, endedAt: later.toISOString() });
    expect(stopped?.steps).toHaveLength(MAX_STEPS);
  });

  it('pauses with a reason, resumes, and stops', async () => {
    await start();
    expect(await pauseRecording(1, 'left')).toMatchObject({ status: 'paused', pausedReason: 'left' });
    const resumed = await resumeRecording(1);
    expect(resumed?.status).toBe('recording');
    expect(resumed).not.toHaveProperty('pausedReason');
    await pauseRecording(1, 'user');
    const stopped = await stopRecording(1, later);
    expect(stopped).toMatchObject({ status: 'stopped', endedAt: later.toISOString() });
    expect(stopped).not.toHaveProperty('pausedReason');
  });

  it('does not resume a stopped recording', async () => {
    await start();
    await stopRecording(1, later);
    expect((await resumeRecording(1))?.status).toBe('stopped');
  });

  it('removes a recording and hands it back', async () => {
    await start();
    expect(await removeRecording(1)).toMatchObject({ tabId: 1 });
    expect(await getRecording(1)).toBeNull();
    expect(await removeRecording(1)).toBeNull();
  });

  it('notifies watchers of their own tab only', async () => {
    const onTab1 = vi.fn();
    const unwatch = watchRecording(1, onTab1);
    await start(2);
    await start(1);
    expect(onTab1).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: 1 }));
    await removeRecording(1);
    expect(onTab1).toHaveBeenLastCalledWith(null);
    unwatch();
  });
});
