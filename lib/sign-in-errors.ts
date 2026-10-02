import { SESSION_ENDED } from './api/errors';
import { CANCELLED_MESSAGE, NO_SESSION_MESSAGE, STATE_MISMATCH_MESSAGE } from './auth/session';

export type SignInProblem = { tone: 'error' | 'notice'; title: string; detail: string };

/** Turns a sign-in or session message into what happened and what to do next. */
export function describeSignInError(message: string): SignInProblem {
  switch (message) {
    case CANCELLED_MESSAGE:
      return {
        tone: 'error',
        title: 'Sign-in was closed before it finished.',
        detail:
          'Try again. If the window showed the Auto Agent site instead of closing, this extension is not allowed yet; ask the Auto Agent team to add its ID.',
      };
    case STATE_MISMATCH_MESSAGE:
      return {
        tone: 'error',
        title: 'Sign-in got mixed up with another attempt.',
        detail: 'Try again, and keep only one sign-in window open.',
      };
    case NO_SESSION_MESSAGE:
      return {
        tone: 'error',
        title: 'Auto Agent did not finish signing you in.',
        detail: 'Try again. If it keeps happening, check that your Microsoft account is a user in Auto Agent.',
      };
    case SESSION_ENDED:
      return { tone: 'notice', title: 'Your session ended.', detail: 'Sign in again to keep reviewing.' };
    default:
      return { tone: 'error', title: 'Sign-in failed.', detail: message };
  }
}
