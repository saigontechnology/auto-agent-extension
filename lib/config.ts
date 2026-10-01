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
