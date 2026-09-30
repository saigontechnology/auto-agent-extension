import { browser } from '#imports';
import type { BackgroundRequest, BackgroundResponse, Result } from './messages';

/** Sends a request to the background service worker and always resolves with a Result. */
export async function sendToBackground<T extends BackgroundRequest['type']>(
  request: Extract<BackgroundRequest, { type: T }>,
): Promise<Result<BackgroundResponse[T]>> {
  try {
    const response = (await browser.runtime.sendMessage(request)) as
      | Result<BackgroundResponse[T]>
      | undefined;
    return response ?? { ok: false, code: 'failed', error: 'The extension did not respond.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The extension did not respond.';
    return { ok: false, code: 'failed', error: message };
  }
}
