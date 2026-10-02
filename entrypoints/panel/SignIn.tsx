import { describeSignInError } from '@/lib/sign-in-errors';

type Props = { busy: boolean; error: string | null; onSignIn: () => void };

/** What a reviewer does once signed in, shown with the same numbered pins they will place. */
const STEPS = [
  'Pin a comment on any element',
  'Rewrite text right on the page',
  'Send. Auto Agent applies your feedback and redeploys the demo',
];

function MicrosoftLogo() {
  return (
    <svg className="signin__logo" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** The whole panel while signed out: nothing can be reviewed or sent without an account. */
export function SignIn({ busy, error, onSignIn }: Props) {
  const problem = error ? describeSignInError(error) : null;

  return (
    <div className="signin">
      <h2 className="signin__title">Review this demo with Auto Agent</h2>
      <p className="signin__lead">Sign in once with your Saigon Technology Microsoft account.</p>

      {problem && (
        <div className={problem.tone === 'error' ? 'signin__problem signin__problem--error' : 'signin__problem'} role="alert">
          <p className="signin__problem-title">{problem.title}</p>
          <p>{problem.detail}</p>
        </div>
      )}

      <ol className="signin__steps" aria-label="What you can do">
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="badge" aria-hidden="true">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <button type="button" className="primary signin__button" disabled={busy} onClick={onSignIn}>
        <MicrosoftLogo />
        {busy ? 'Waiting for Microsoft…' : problem?.tone === 'error' ? 'Try again' : 'Sign in with Microsoft'}
      </button>
      <p className="signin__note" aria-live="polite">
        {busy
          ? 'If a Microsoft window opens, finish signing in there.'
          : 'Nothing reaches Auto Agent until you press Send.'}
      </p>
    </div>
  );
}
