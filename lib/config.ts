/**
 * Switches for the period before the vibe-coding tool is connected. Flip both to go back to
 * the behaviour in the design spec.
 */

/**
 * When false, any page can be reviewed: a page without the `vibe:project-id` and
 * `vibe:build-id` meta tags uses its host as the project and `local` as the build.
 * When true, such a page is reported as "not a preview build".
 */
export const REQUIRE_PREVIEW_MARKERS: boolean = false;

/**
 * When true, feedback is always stored in this browser: the review panel hides API settings
 * and sign-in, and the background ignores any saved API settings.
 */
export const LOCAL_ONLY: boolean = true;

/**
 * When false, the review panel hides the Record workflow button, so no new workflow can be
 * recorded. Existing workflow drafts and sent workflows are still listed.
 */
export const WORKFLOW_RECORDING: boolean = false;

/** Auto Agent's API. End-to-end tests build against a fake one through `WXT_API_BASE`. */
export const API_BASE: string =
  (import.meta.env.WXT_API_BASE as string | undefined) || 'https://vibe.saigontechnology.vn/api/v1';

/** The Auto Agent web app; a run opens at `${WEB_BASE}/jobs/<id>`. */
export const WEB_BASE: string = new URL(API_BASE).origin;
