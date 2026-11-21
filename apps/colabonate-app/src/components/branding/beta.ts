// Client-side demo-login visibility — dev/E2E only (a PROD build is always false).
//
// The former `VITE_BETA_BADGE` / `BETA_BADGE_ENABLED` flag was removed
// 2026-09-23 after the beta host (colabonate.app) was retired: the "Beta"
// badge in the main menu is now rendered unconditionally, and the badge that
// used to be pinned to the login/onboarding/error logo was dropped.
export const DEMO_LOGIN_ENABLED = !import.meta.env.PROD
