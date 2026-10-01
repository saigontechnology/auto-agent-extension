type Props = { busy: boolean; error: string | null; onSignIn: () => void };

/** The whole panel while signed out: nothing can be reviewed or sent without an account. */
export function SignIn({ busy, error, onSignIn }: Props) {
  return (
    <div className="signin">
      <p>
        Sign in with your Saigon Technology Microsoft account to review this page and send feedback
        to Auto Agent.
      </p>
      <button type="button" className="primary signin__button" disabled={busy} onClick={onSignIn}>
        {busy ? 'Signing in…' : 'Sign in with Microsoft'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
