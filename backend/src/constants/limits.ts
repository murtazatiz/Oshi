// ─────────────────────────────────────────────────────────────────────────────
// Free-plan limits — PRD §8.1. Pro and trial users bypass both.
// ─────────────────────────────────────────────────────────────────────────────

/** Saves per calendar month (counter reset on the 1st by cron). */
export const FREE_MONTHLY_SAVE_LIMIT = 20;

/**
 * Custom categories — rows with is_system_default = false; the 11 seeded
 * defaults never count (ADR-0019). Free users can't create a 4th, and a
 * downgraded user holding more can't add saves until back within it (§3.7.4).
 */
export const FREE_CUSTOM_CATEGORY_LIMIT = 3;
