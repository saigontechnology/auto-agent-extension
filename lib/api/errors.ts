export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const SESSION_ENDED = 'Your session ended. Sign in again.';

/** The session is gone: the reviewer has to sign in again. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super(SESSION_ENDED, 401);
    this.name = 'UnauthorizedError';
  }
}

export const NETWORK_ERROR = 'Could not reach Auto Agent. Check your connection.';
export const UNEXPECTED_RESPONSE = 'Auto Agent sent an unexpected response.';

/** The `message` of an Auto Agent response envelope, when the body has a usable one. */
export function envelopeMessage(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : undefined;
}
