import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDictionaryOverrides,
  getDictionaryOverrides,
  resetDictionaryOverridesForTests,
  resolveLabel,
  availableLabels,
  formatOverridesSummary,
  appendOverridesToDescription,
} from "./dictionary-overrides.js";
import { logger } from "../services/logger.js";

vi.mock("../services/logger.js", () => {
  const mock: Record<string, unknown> = {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
  mock.child = vi.fn(() => mock);
  return { logger: mock };
});

/** Helper: build an env object (only the keys we set; rest undefined). */
function env(value?: string): NodeJS.ProcessEnv {
  return (value === undefined ? {} : { BOOND_DICTIONARY_OVERRIDES: value }) as NodeJS.ProcessEnv;
}

const VALID = JSON.stringify({
  action: { contact: { Call: 61, Email: 63 }, candidate: { Interview: 40 } },
  state: { candidate: { Interviewed: 2 } },
});

beforeEach(() => {
  vi.mocked(logger.warn).mockClear();
  delete process.env.BOOND_DICTIONARY_OVERRIDES;
  resetDictionaryOverridesForTests();
});

afterEach(() => {
  delete process.env.BOOND_DICTIONARY_OVERRIDES;
  resetDictionaryOverridesForTests();
});

describe("loadDictionaryOverrides", () => {
  it("returns null when the env var is absent", () => {
    expect(loadDictionaryOverrides(env())).toBeNull();
  });

  it("ignores unresolved placeholder values like ${VAR}", () => {
    expect(loadDictionaryOverrides(env("${user_config.dictionary_overrides}"))).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("parses valid inline JSON", () => {
    const overrides = loadDictionaryOverrides(env(VALID));
    expect(overrides).not.toBeNull();
    expect(overrides!.action["contact"]).toEqual({ Call: 61, Email: 63 });
    expect(overrides!.state["candidate"]).toEqual({ Interviewed: 2 });
  });

  it("parses a JSON file when the value is a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "boond-overrides-"));
    const file = join(dir, "overrides.json");
    try {
      writeFileSync(file, VALID, "utf-8");
      const overrides = loadDictionaryOverrides(env(file));
      expect(overrides).not.toBeNull();
      expect(overrides!.action["candidate"]).toEqual({ Interview: 40 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null (and warns) when the file does not exist", () => {
    expect(loadDictionaryOverrides(env("/nonexistent/overrides.json"))).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns null (and warns, no throw) on invalid JSON", () => {
    expect(() => loadDictionaryOverrides(env("{not json"))).not.toThrow();
    expect(loadDictionaryOverrides(env("{not json"))).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns null (and warns) on an invalid structure (non-integer id)", () => {
    const bad = JSON.stringify({ action: { contact: { Call: "sixty-one" } } });
    expect(loadDictionaryOverrides(env(bad))).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns null (and warns) on an unknown top-level section", () => {
    const bad = JSON.stringify({ actions: { contact: { Call: 61 } } });
    expect(loadDictionaryOverrides(env(bad))).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("warns and ignores an unknown entity, keeping the valid ones", () => {
    const mixed = JSON.stringify({ action: { contact: { Call: 61 }, spaceship: { Launch: 1 } } });
    const overrides = loadDictionaryOverrides(env(mixed));
    expect(overrides).not.toBeNull();
    expect(overrides!.action["contact"]).toEqual({ Call: 61 });
    expect(overrides!.action["spaceship"]).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ section: "action", entity: "spaceship" }),
      expect.stringContaining("spaceship")
    );
  });

  it("returns null when nothing usable remains after validation", () => {
    expect(loadDictionaryOverrides(env("{}"))).toBeNull();
    expect(loadDictionaryOverrides(env(JSON.stringify({ action: { spaceship: { Launch: 1 } } })))).toBeNull();
  });
});

describe("getDictionaryOverrides (singleton)", () => {
  it("lazily loads from process.env and caches the result", () => {
    process.env.BOOND_DICTIONARY_OVERRIDES = VALID;
    resetDictionaryOverridesForTests();
    const first = getDictionaryOverrides();
    expect(first).not.toBeNull();
    // Mutating the env without resetting must NOT change the cached value.
    delete process.env.BOOND_DICTIONARY_OVERRIDES;
    expect(getDictionaryOverrides()).toBe(first);
    resetDictionaryOverridesForTests();
    expect(getDictionaryOverrides()).toBeNull();
  });
});

describe("resolveLabel", () => {
  beforeEach(() => {
    process.env.BOOND_DICTIONARY_OVERRIDES = VALID;
    resetDictionaryOverridesForTests();
  });

  it("resolves an exact label", () => {
    expect(resolveLabel("action", "contact", "Call")).toBe(61);
    expect(resolveLabel("state", "candidate", "Interviewed")).toBe(2);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveLabel("action", "contact", "  cAlL ")).toBe(61);
    expect(resolveLabel("state", "candidate", "INTERVIEWED")).toBe(2);
  });

  it("returns undefined for an unknown label or entity", () => {
    expect(resolveLabel("action", "contact", "Visio")).toBeUndefined();
    expect(resolveLabel("action", "project", "Call")).toBeUndefined();
  });

  it("returns undefined when no overrides are configured", () => {
    delete process.env.BOOND_DICTIONARY_OVERRIDES;
    resetDictionaryOverridesForTests();
    expect(resolveLabel("action", "contact", "Call")).toBeUndefined();
  });
});

describe("availableLabels", () => {
  it("lists the labels with their original casing", () => {
    process.env.BOOND_DICTIONARY_OVERRIDES = VALID;
    resetDictionaryOverridesForTests();
    expect(availableLabels("action", "contact")).toEqual(["Call", "Email"]);
    expect(availableLabels("action", "project")).toEqual([]);
  });

  it("returns [] when no overrides are configured", () => {
    expect(availableLabels("action", "contact")).toEqual([]);
  });
});

describe("formatOverridesSummary / appendOverridesToDescription", () => {
  it("appends the accepted labels when overrides exist", () => {
    process.env.BOOND_DICTIONARY_OVERRIDES = VALID;
    resetDictionaryOverridesForTests();
    expect(formatOverridesSummary("action", "contact")).toBe("Call=61, Email=63");
    const out = appendOverridesToDescription("Base.", "action", "contact");
    expect(out).toBe("Base.\nLibellés personnalisés acceptés (résolus automatiquement) : Call=61, Email=63");
  });

  it("returns the base string unchanged without overrides", () => {
    expect(formatOverridesSummary("action", "contact")).toBeNull();
    expect(appendOverridesToDescription("Base.", "action", "contact")).toBe("Base.");
  });

  it("returns the base string unchanged for an entity without overrides", () => {
    process.env.BOOND_DICTIONARY_OVERRIDES = VALID;
    resetDictionaryOverridesForTests();
    expect(appendOverridesToDescription("Base.", "action", "opportunity")).toBe("Base.");
  });
});
