/**
 * The one place configuration is read from the environment.
 *
 * Six readers used to coexist (`index.ts`, `transports/http.ts`,
 * `services/oauth.ts`, `services/boond-client.ts`, `config/access-policy.ts`,
 * `config/dictionary-overrides.ts`) and they disagreed on the one rule that
 * matters for the packaged channels (issue #242): the MCPB manifest and the
 * Claude Code plugin substitute `${user_config.KEY}` into **every** `BOOND_*`
 * variable, so an option the user never filled arrives as `""`, as whitespace,
 * or as the unsubstituted `"${…}"` — and only one of the six rejected the
 * whitespace form. `MCP_HTTP_PATH=" "` became the endpoint path,
 * `BOOND_OAUTH_AUTHORIZATION_SERVER=" "` broke the discovery document.
 *
 * Rule, applied by every reader here: `""`, whitespace-only and an
 * unresolved `${…}` placeholder all mean *not configured*. A blank value must
 * never switch a security control off (`MCP_HTTP_ALLOWED_HOSTS`) nor a
 * restriction on (`BOOND_MCP_DOMAINS`); it falls through to the default.
 *
 * Every reader takes the environment as its last argument so the config
 * modules that already accept an `env` for testing keep doing so.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

/** True when the raw value is one of the three "not configured" shapes. */
export function isUnset(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const trimmed = raw.trim();
  return trimmed.length === 0 || trimmed.startsWith("${");
}

/**
 * The variable's value, or `undefined` when it is absent / blank / an
 * unresolved placeholder. The value is returned as-is (not trimmed): a
 * password may legitimately end with a space. Callers that want a token
 * trim it themselves.
 */
export function readString(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[name];
  return isUnset(raw) ? undefined : raw;
}

/**
 * A boolean switch. `1/true/yes/on` → `true`, `0/false/no/off` → `false`,
 * anything else (unset, blank, placeholder, garbage) → `fallback`. Both
 * spellings are accepted because the packaged channels send booleans as
 * strings with an explicit `default` — `"false"` must not read as "set,
 * therefore on".
 */
export function readBool(name: string, fallback = false, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = readString(name, env)?.trim().toLowerCase();
  if (raw === undefined) return fallback;
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  return fallback;
}

/**
 * A positive integer (floored), or `fallback` for unset, non-numeric, negative
 * or — unless `allowZero` — zero values.
 */
export function readPositiveInt(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
  options: { allowZero?: boolean } = {}
): number {
  const raw = readString(name, env);
  if (raw === undefined) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (parsed === 0 && !options.allowZero) return fallback;
  return Math.floor(parsed);
}

/**
 * A list: comma and/or whitespace separated, trimmed, empties dropped.
 * `undefined` when the variable is not configured **or** yields no token
 * (`" , "`): a list with nothing in it is "unconfigured", never "allow
 * nothing" — the `MCP_HTTP_ALLOWED_HOSTS` rule, applied to every list.
 */
export function readCsv(name: string, env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const raw = readString(name, env);
  if (raw === undefined) return undefined;
  const items = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * An absolute URL, trimmed. Unset / blank / placeholder → `undefined`. A
 * value that is present but not a URL **throws**, naming the variable: the
 * URLs read here (`BOOND_BASE_URL`, `MCP_HTTP_PUBLIC_URL`,
 * `BOOND_OAUTH_AUTHORIZATION_SERVER`) all decide where credentials are sent
 * or where clients are told to go, so a typo must stop the start-up with a
 * readable message rather than surface later as an opaque fetch error or a
 * broken discovery document.
 */
export function readUrl(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = readString(name, env)?.trim();
  if (raw === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${name}: "${raw}" is not an absolute URL (expected e.g. https://host/path)`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${name}: "${raw}" must use http:// or https://`);
  }
  return raw;
}
