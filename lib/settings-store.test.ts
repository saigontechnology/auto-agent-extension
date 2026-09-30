import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  getSettings,
  isConfigured,
  normalizeSettings,
  requiredOrigins,
  saveSettings,
  validateSettings,
} from './settings-store';
import type { Settings } from './types';

const real: Settings = {
  useMock: false,
  apiBase: 'https://api.example.com/v1',
  oauth: {
    authorizeUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'ext',
    scopes: 'feedback',
  },
};

describe('settings-store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to mock mode', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.useMock).toBe(true);
  });

  it('saves normalised settings', async () => {
    await saveSettings({ ...real, apiBase: '  https://api.example.com/v1// ' });
    expect((await getSettings()).apiBase).toBe('https://api.example.com/v1');
  });

  it('trims the OAuth fields', () => {
    const normalised = normalizeSettings({
      ...real,
      oauth: { ...real.oauth, clientId: ' ext ', scopes: ' feedback ' },
    });
    expect(normalised.oauth.clientId).toBe('ext');
    expect(normalised.oauth.scopes).toBe('feedback');
  });
});

describe('validateSettings', () => {
  it('accepts anything in mock mode', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(true);
  });

  it('accepts complete real settings', () => {
    expect(validateSettings(real)).toEqual([]);
  });

  it('accepts http only for localhost', () => {
    expect(validateSettings({ ...real, apiBase: 'http://localhost:8787' })).toEqual([]);
    expect(validateSettings({ ...real, apiBase: 'http://api.example.com' })).toEqual([
      'API base URL must be an https URL.',
    ]);
  });

  it('reports every missing field when mock is off', () => {
    const errors = validateSettings({ ...DEFAULT_SETTINGS, useMock: false });
    expect(errors).toHaveLength(4);
    expect(isConfigured({ ...DEFAULT_SETTINGS, useMock: false })).toBe(false);
  });

  it('rejects text that is not a URL', () => {
    expect(validateSettings({ ...real, apiBase: 'not a url' })).toEqual([
      'API base URL must be an https URL.',
    ]);
  });
});

describe('requiredOrigins', () => {
  it('returns one pattern per distinct host, without ports or paths', () => {
    expect(requiredOrigins(real)).toEqual(['https://api.example.com/*', 'https://auth.example.com/*']);
    expect(requiredOrigins({ ...real, apiBase: 'http://localhost:8787/api' })).toContain(
      'http://localhost/*',
    );
  });

  it('deduplicates and skips invalid URLs', () => {
    const sameHost = { ...real, apiBase: 'https://auth.example.com/api' };
    expect(requiredOrigins(sameHost)).toEqual(['https://auth.example.com/*']);
    expect(requiredOrigins({ ...real, apiBase: 'nope' })).toEqual(['https://auth.example.com/*']);
  });
});
