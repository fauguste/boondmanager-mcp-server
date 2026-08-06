import { describe, it, expect } from "vitest";
import { isFeatureDisabled } from "./env-flags.js";

/**
 * `isFeatureDisabled` backs the two "on unless explicitly turned off" switches,
 * `BOOND_MCP_ICONS` and `BOOND_MCP_CONFIRM_DELETE`.
 *
 * `confirm_delete` is exposed as a `type: "boolean"` option in both packaged
 * install channels (MCPB `manifest.json`, Claude Code plugin `.mcp.json`), which
 * means what actually reaches the process is a *string*: `"true"`, `"false"`, or
 * — for an option the user never touched — an empty value or an unsubstituted
 * `${user_config.confirm_delete}`. Only the explicit "off" spellings may disable
 * the delete confirmation; every ambiguous value has to leave it on, because the
 * failure mode of guessing wrong is an irreversible unconfirmed delete.
 */
describe("isFeatureDisabled", () => {
  it.each(["0", "false", "no", "off"])('disables on the explicit "off" value %s', (raw) => {
    expect(isFeatureDisabled(raw)).toBe(true);
  });

  it.each(["FALSE", "Off", " no ", "  0"])("is case- and whitespace-insensitive (%s)", (raw) => {
    expect(isFeatureDisabled(raw)).toBe(true);
  });

  it.each(["1", "true", "yes", "on"])("stays enabled on an explicit on-value (%s)", (raw) => {
    expect(isFeatureDisabled(raw)).toBe(false);
  });

  // The packaged-install cases: an untouched option, and a host that did not
  // substitute. Both must leave the feature enabled.
  it.each([
    ["absent", undefined],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["unsubstituted placeholder", "${user_config.confirm_delete}"],
    ["a value that means nothing here", "maybe"],
  ])("stays enabled when the value is %s", (_label, raw) => {
    expect(isFeatureDisabled(raw)).toBe(false);
  });
});
