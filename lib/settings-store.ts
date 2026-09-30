import { storage } from '#imports';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  useMock: true,
  apiBase: '',
  oauth: { authorizeUrl: '', tokenUrl: '', clientId: '', scopes: '' },
};

const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export function normalizeSettings(settings: Settings): Settings {
  return {
    useMock: settings.useMock,
    apiBase: settings.apiBase.trim().replace(/\/+$/, ''),
    oauth: {
      authorizeUrl: settings.oauth.authorizeUrl.trim(),
      tokenUrl: settings.oauth.tokenUrl.trim(),
      clientId: settings.oauth.clientId.trim(),
      scopes: settings.oauth.scopes.trim(),
    },
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isAllowedUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
}

/** Returns human-readable problems; an empty list means the settings can be saved. */
export function validateSettings(settings: Settings): string[] {
  if (settings.useMock) return [];
  const errors: string[] = [];
  if (!isAllowedUrl(settings.apiBase)) errors.push('API base URL must be an https URL.');
  if (!isAllowedUrl(settings.oauth.authorizeUrl)) errors.push('Authorize URL must be an https URL.');
  if (!isAllowedUrl(settings.oauth.tokenUrl)) errors.push('Token URL must be an https URL.');
  if (!settings.oauth.clientId) errors.push('Client ID is required.');
  return errors;
}

export function isConfigured(settings: Settings): boolean {
  return validateSettings(settings).length === 0;
}

/** Host-permission patterns the background needs in order to call the API and token endpoint. */
export function requiredOrigins(settings: Settings): string[] {
  const patterns = [settings.apiBase, settings.oauth.tokenUrl]
    .map(parseUrl)
    .filter((url): url is URL => url !== null)
    .map((url) => `${url.protocol}//${url.hostname}/*`);
  return Array.from(new Set(patterns));
}

export function getSettings(): Promise<Settings> {
  return settingsItem.getValue();
}

export function saveSettings(settings: Settings): Promise<void> {
  return settingsItem.setValue(normalizeSettings(settings));
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((settings) => callback(settings ?? DEFAULT_SETTINGS));
}
