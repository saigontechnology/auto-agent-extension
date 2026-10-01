import { type FormEvent, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { LOCAL_ONLY } from '@/lib/config';
import {
  getSettings,
  normalizeSettings,
  requiredOrigins,
  saveSettings,
  validateSettings,
} from '@/lib/settings-store';
import type { OAuthSettings, Settings } from '@/lib/types';

type Status = { kind: 'ok' | 'error'; messages: string[] };

function CompanyLogo() {
  return (
    <picture>
      <source srcSet="/brand/logo-white.svg" media="(prefers-color-scheme: dark)" />
      <img
        className="options__logo"
        src="/brand/logo-black.svg"
        alt="Saigon Technology"
        width="175"
        height="40"
      />
    </picture>
  );
}

export function App() {
  const [form, setForm] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void getSettings().then(setForm);
  }, []);

  if (LOCAL_ONLY) {
    return (
      <div className="options">
        <CompanyLogo />
        <h1>Auto Agent options</h1>
        <p className="notice">
          API settings are turned off in this build. Feedback is stored in this browser only.
        </p>
      </div>
    );
  }

  // The form is rendered only once the saved settings have loaded; otherwise an edit made
  // in the meantime would be overwritten when they arrive.
  if (!form) return null;

  const setOAuth = (patch: Partial<OAuthSettings>) =>
    setForm({ ...form, oauth: { ...form.oauth, ...patch } });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeSettings(form);
    const errors = validateSettings(next);
    if (errors.length > 0) {
      setStatus({ kind: 'error', messages: errors });
      return;
    }
    if (!next.useMock) {
      // Must stay the first await: Chrome only allows permission prompts inside a user gesture.
      const granted = await browser.permissions
        .request({ origins: requiredOrigins(next) })
        .catch(() => false);
      if (!granted) {
        setStatus({
          kind: 'error',
          messages: ['Access to the API host was not granted, so nothing was saved.'],
        });
        return;
      }
    }
    await saveSettings(next);
    setForm(next);
    setStatus({ kind: 'ok', messages: ['Saved.'] });
  };

  return (
    <form className="options" onSubmit={(event) => void onSubmit(event)}>
      <CompanyLogo />
      <h1>Auto Agent options</h1>

      <label className="check">
        <input
          type="checkbox"
          checked={form.useMock}
          onChange={(event) => setForm({ ...form, useMock: event.target.checked })}
        />
        Use mock API (feedback stays in this browser)
      </label>

      <fieldset disabled={form.useMock}>
        <label>
          API base URL
          <input
            type="url"
            placeholder="https://tool.example.com/api"
            value={form.apiBase}
            onChange={(event) => setForm({ ...form, apiBase: event.target.value })}
          />
        </label>
        <label>
          OAuth authorize URL
          <input
            type="url"
            value={form.oauth.authorizeUrl}
            onChange={(event) => setOAuth({ authorizeUrl: event.target.value })}
          />
        </label>
        <label>
          OAuth token URL
          <input
            type="url"
            value={form.oauth.tokenUrl}
            onChange={(event) => setOAuth({ tokenUrl: event.target.value })}
          />
        </label>
        <label>
          OAuth client ID
          <input
            type="text"
            value={form.oauth.clientId}
            onChange={(event) => setOAuth({ clientId: event.target.value })}
          />
        </label>
        <label>
          OAuth scopes (space separated)
          <input
            type="text"
            value={form.oauth.scopes}
            onChange={(event) => setOAuth({ scopes: event.target.value })}
          />
        </label>
        <p className="notice">
          Register this redirect URI with the tool: <code>{browser.identity.getRedirectURL()}</code>
        </p>
      </fieldset>

      {status && (
        <div className={status.kind === 'error' ? 'error' : 'notice'} role="status">
          {status.messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <button type="submit" className="primary submit">
        Save
      </button>
    </form>
  );
}
