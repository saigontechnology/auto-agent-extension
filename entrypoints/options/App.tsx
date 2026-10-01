import { useEffect, useState } from 'react';
import { type Session, getSession, watchSession } from '@/lib/auth/session';
import { sendToBackground } from '@/lib/background-client';

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
  // Undefined until the stored session has been read, so the page does not flash "Not signed in".
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void getSession().then(setSession);
    return watchSession(setSession);
  }, []);

  return (
    <div className="options">
      <CompanyLogo />
      <h1>Auto Agent options</h1>
      {session === null && (
        <p className="notice">Not signed in. Open the Auto Agent panel on a page to sign in.</p>
      )}
      {session && (
        <>
          <p className="options__account">
            Signed in as <strong>{session.user.displayName}</strong> ({session.user.username})
          </p>
          <button
            type="button"
            className="primary submit"
            onClick={() => void sendToBackground({ type: 'sign-out' })}
          >
            Sign out
          </button>
        </>
      )}
    </div>
  );
}
