/**
 * Shared parsing for the `BOOND_MCP_*` opt-out switches.
 *
 * Both toggles (`BOOND_MCP_ICONS`, `BOOND_MCP_CONFIRM_DELETE`) are
 * "on unless explicitly turned off", and both accepted the same four spellings
 * through two identical copies of this function. One copy means the accepted
 * vocabulary can't drift between switches.
 */

const OFF_VALUES = ["0", "false", "no", "off"];

/** Is this env var explicitly set to an "off" value? Absent/empty = not disabled. */
export function isFeatureDisabled(raw: string | undefined): boolean {
  if (!raw) return false;
  return OFF_VALUES.includes(raw.trim().toLowerCase());
}
