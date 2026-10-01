import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { listDrafts } from '../draft-store';
import { clickStep, networkStep } from '../test-helpers';
import type { PageContext } from '../types';
import { type FlowDeps, createFlowHandlers } from './flow-handlers';
import { getRecording } from './recording-store';

const TAB = 5;
const context: PageContext = {
  projectId: 'proj',
  buildId: 'b1',
  path: '/login',
  url: 'https://demo.web.app/login',
  title: 'Sign in',
};
const other: PageContext = { ...context, projectId: 'accounts.example.com', path: '/', url: 'https://accounts.example.com/' };
const viewport = { width: 1000, height: 800, dpr: 1 };

function setup() {
  let n = 0;
  const deps: FlowDeps = {
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    newId: () => `id-${++n}`,
    notify: vi.fn(),
  };
  return { flow: createFlowHandlers(deps), deps };
}

async function started() {
  const handlers = setup();
  await handlers.flow.content({ type: 'flow-start', context, viewport }, TAB);
  return handlers;
}

const steps = async () => (await getRecording(TAB))?.steps ?? [];

describe('flow handlers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts a recording and tells the tab', async () => {
    const { flow, deps } = setup();
    const state = await flow.content({ type: 'flow-start', context, viewport }, TAB);
    expect(state).toEqual({ status: 'recording', steps: 0 });
    expect(deps.notify).toHaveBeenCalledWith(TAB, { status: 'recording', steps: 0 });
  });

  it('records steps the content script sends', async () => {
    const { flow } = await started();
    const state = await flow.content({ type: 'flow-step', step: clickStep('c') }, TAB);
    expect(state).toEqual({ status: 'recording', steps: 1 });
  });

  it('records a new document in the same project as a navigate step', async () => {
    const { flow } = await started();
    await flow.content(
      { type: 'flow-hello', context: { ...context, path: '/home' }, url: 'https://demo.web.app/home', navigation: 'reload' },
      TAB,
    );
    expect(await steps()).toMatchObject([{ type: 'navigate', cause: 'reload', path: '/home', url: 'https://demo.web.app/home' }]);
  });

  it('pauses when the tab leaves the project and resumes when it returns', async () => {
    const { flow } = await started();
    const away = await flow.content({ type: 'flow-hello', context: other, url: other.url, navigation: 'load' }, TAB);
    expect(away.status).toBe('paused');
    expect(await steps()).toMatchObject([{ type: 'left', url: other.url, path: '/login' }]);

    await flow.content({ type: 'flow-step', step: clickStep('ignored') }, TAB);
    const back = await flow.content({ type: 'flow-hello', context, url: context.url, navigation: 'history' }, TAB);
    expect(back.status).toBe('recording');
    expect((await steps()).map((s) => s.type)).toEqual(['left', 'navigate']);
  });

  it('treats a page that is not a preview as leaving the project', async () => {
    const { flow } = await started();
    await flow.content({ type: 'flow-hello', context: null, url: 'https://x.dev/', navigation: 'load' }, TAB);
    expect((await getRecording(TAB))?.pausedReason).toBe('left');
  });

  it('records nothing on a new document while the reviewer has paused', async () => {
    const { flow } = await started();
    await flow.request({ type: 'flow-pause', tabId: TAB });
    await flow.content({ type: 'flow-hello', context, url: context.url, navigation: 'load' }, TAB);
    expect(await getRecording(TAB)).toMatchObject({ status: 'paused', pausedReason: 'user', steps: [] });
  });

  it('answers a hello from a tab that is not recording', async () => {
    const { flow, deps } = setup();
    const state = await flow.content({ type: 'flow-hello', context, url: context.url, navigation: 'load' }, TAB);
    expect(state).toEqual({ status: 'none', steps: 0 });
    expect(deps.notify).toHaveBeenCalledWith(TAB, { status: 'none', steps: 0 });
  });

  it('records a tab opened from the recorded tab, once its URL is known', async () => {
    const { flow } = await started();
    await flow.tabCreated({ id: 9, openerTabId: TAB, pendingUrl: 'https://docs.example.com/' });
    await flow.tabCreated({ id: 10, openerTabId: TAB, url: 'about:blank' });
    await flow.tabUpdated(10, 'about:blank');
    await flow.tabUpdated(10, 'https://help.example.com/');
    await flow.tabUpdated(10, 'https://help.example.com/again');
    await flow.tabCreated({ id: 11, openerTabId: 99, url: 'https://x.dev/' });
    expect(await steps()).toMatchObject([
      { type: 'new-tab', url: 'https://docs.example.com/' },
      { type: 'new-tab', url: 'https://help.example.com/' },
    ]);
  });

  it('inserts a note at the page the panel is on', async () => {
    const { flow } = await started();
    await flow.request({ type: 'flow-note', tabId: TAB, text: '  Slow here ', path: '/home' });
    expect(await steps()).toMatchObject([{ type: 'note', text: 'Slow here', path: '/home' }]);
  });

  it('stops, then saves a recording as a draft and forgets it', async () => {
    const { flow, deps } = await started();
    await flow.content({ type: 'flow-step', step: clickStep('c') }, TAB);
    await flow.content({ type: 'flow-step', step: networkStep('n', 500) }, TAB);
    await flow.request({ type: 'flow-stop', tabId: TAB });
    expect((await getRecording(TAB))?.status).toBe('stopped');

    const item = await flow.request({
      type: 'flow-save',
      tabId: TAB,
      edits: { title: 'Sign-in fails', expected: 'e', actual: 'a', failedStepId: 'n', steps: await steps() },
    });
    expect(item).toMatchObject({ kind: 'flow', comment: 'Sign-in fails', flow: { failedStepId: 'n' } });
    expect((await listDrafts('proj')).map((d) => d.kind)).toEqual(['flow']);
    expect(await getRecording(TAB)).toBeNull();
    expect(deps.notify).toHaveBeenLastCalledWith(TAB, { status: 'none', steps: 0 });
  });

  it('fails to save a recording that no longer exists', async () => {
    const { flow } = setup();
    await expect(
      flow.request({ type: 'flow-save', tabId: TAB, edits: { title: 't', expected: '', actual: '', steps: [] } }),
    ).rejects.toThrow('no longer exists');
  });

  it('discards a recording', async () => {
    const { flow } = await started();
    await flow.request({ type: 'flow-discard', tabId: TAB });
    expect(await getRecording(TAB)).toBeNull();
    expect(await listDrafts('proj')).toEqual([]);
  });

  it('keeps the steps of a closed tab as an untitled draft', async () => {
    const { flow } = await started();
    await flow.content({ type: 'flow-step', step: clickStep('c') }, TAB);
    await flow.tabRemoved(TAB);
    expect(await getRecording(TAB)).toBeNull();
    expect(await listDrafts('proj')).toMatchObject([{ kind: 'flow', comment: '', flow: { steps: [{ id: 'c' }] } }]);
  });

  it('saves nothing for a closed tab whose recording has no steps', async () => {
    const { flow } = await started();
    await flow.tabRemoved(TAB);
    expect(await listDrafts('proj')).toEqual([]);
  });
});
