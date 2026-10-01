import { browser } from 'wxt/browser';
import type { ClientInfo } from './types';

/** Identifies this extension build to the feedback API. */
export function clientInfo(): ClientInfo {
  return { extensionVersion: browser.runtime.getManifest().version, userAgent: navigator.userAgent };
}
