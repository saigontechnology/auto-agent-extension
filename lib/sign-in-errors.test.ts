import { describe, expect, it } from 'vitest';
import { SESSION_ENDED } from './api/errors';
import { CANCELLED_MESSAGE, STATE_MISMATCH_MESSAGE } from './auth/session';
import { describeSignInError } from './sign-in-errors';

describe('describeSignInError', () => {
  it('explains a closed sign-in window and the allow-list case', () => {
    const problem = describeSignInError(CANCELLED_MESSAGE);
    expect(problem.tone).toBe('error');
    expect(problem.title).toBe('Sign-in was closed before it finished.');
    expect(problem.detail).toContain('ask the Auto Agent team to add its ID');
  });

  it('asks for one sign-in window when the response did not match', () => {
    expect(describeSignInError(STATE_MISMATCH_MESSAGE)).toMatchObject({
      tone: 'error',
      title: 'Sign-in got mixed up with another attempt.',
    });
  });

  it('points at the Auto Agent account when no session came back', () => {
    expect(describeSignInError('Sign-in did not return a session. Try again.').detail).toContain(
      'a user in Auto Agent',
    );
  });

  it('treats an ended session as a notice, not a failure', () => {
    expect(describeSignInError(SESSION_ENDED)).toEqual({
      tone: 'notice',
      title: 'Your session ended.',
      detail: 'Sign in again to keep reviewing.',
    });
  });

  it('shows any other message as it is', () => {
    expect(describeSignInError('Could not reach Auto Agent. Check your connection.')).toEqual({
      tone: 'error',
      title: 'Sign-in failed.',
      detail: 'Could not reach Auto Agent. Check your connection.',
    });
  });
});
