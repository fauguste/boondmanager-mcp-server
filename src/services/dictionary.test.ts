import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as boondClient from "./boond-client.js";
import { getDictionary, resolveDictionaryPath, resetDictionaryCacheForTests } from "./dictionary.js";

describe("dictionary service", () => {
  beforeEach(() => {
    resetDictionaryCacheForTests();
    vi.restoreAllMocks();
    delete process.env["BOOND_DICTIONARY_TTL_MS"];
  });

  afterEach(() => {
    delete process.env["BOOND_DICTIONARY_TTL_MS"];
  });

  describe("getDictionary", () => {
    it("fetches /application/dictionary on first call with default language=fr", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: {} },
      } as never);
      const result = await getDictionary();
      expect(apiSpy).toHaveBeenCalledTimes(1);
      expect(apiSpy).toHaveBeenCalledWith("/application/dictionary", "GET", undefined, {
        language: "fr",
      });
      expect(result.language).toBe("fr");
      expect(result.payload).toEqual({ data: { setting: {} } });
    });

    it("returns the cached entry on subsequent calls within the TTL", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: { tool: [{ id: 1 }] } },
      } as never);
      const r1 = await getDictionary();
      const r2 = await getDictionary();
      const r3 = await getDictionary();
      expect(apiSpy).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });

    it("re-fetches when force=true is passed", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: {} },
      } as never);
      await getDictionary();
      await getDictionary({ force: true });
      expect(apiSpy).toHaveBeenCalledTimes(2);
    });

    it("re-fetches when the requested language differs from the cached one", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: {} },
      } as never);
      await getDictionary({ language: "fr" });
      await getDictionary({ language: "en" });
      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(apiSpy).toHaveBeenNthCalledWith(2, "/application/dictionary", "GET", undefined, {
        language: "en",
      });
    });

    it("deduplicates concurrent fetches into a single API call", async () => {
      let resolve!: (v: unknown) => void;
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockImplementation(
        () =>
          new Promise((res) => {
            resolve = res;
          })
      );
      const p1 = getDictionary();
      const p2 = getDictionary();
      const p3 = getDictionary();
      // Resolve the underlying request once.
      resolve({ data: { setting: {} } });
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(apiSpy).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });

    it("does not poison the cache when the API request fails", async () => {
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce({ data: { setting: {} } } as never);
      await expect(getDictionary()).rejects.toThrow("network down");
      // Subsequent call should retry, not return a cached error.
      const ok = await getDictionary();
      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(ok.payload).toEqual({ data: { setting: {} } });
    });

    it("re-fetches once the TTL expires", async () => {
      process.env["BOOND_DICTIONARY_TTL_MS"] = "1";
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: {} },
      } as never);
      await getDictionary();
      // Wait > TTL so the cache entry is considered stale.
      await new Promise((r) => setTimeout(r, 5));
      await getDictionary();
      expect(apiSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("resolveDictionaryPath", () => {
    const payload = {
      data: {
        setting: {
          state: { resource: [{ id: 1, value: "Actif" }] },
          tool: [{ id: 42, value: "Java" }],
        },
        country: [{ id: "FR", value: "France" }],
        languages: [{ id: "fr", value: "Français" }],
      },
    } as unknown as Parameters<typeof resolveDictionaryPath>[0];

    it("resolves nested setting paths", () => {
      expect(resolveDictionaryPath(payload, "setting.state.resource")).toEqual([{ id: 1, value: "Actif" }]);
      expect(resolveDictionaryPath(payload, "setting.tool")).toEqual([{ id: 42, value: "Java" }]);
    });

    it("resolves top-level data.* paths", () => {
      expect(resolveDictionaryPath(payload, "country")).toEqual([{ id: "FR", value: "France" }]);
      expect(resolveDictionaryPath(payload, "languages")).toEqual([{ id: "fr", value: "Français" }]);
    });

    it("returns undefined for unknown paths", () => {
      expect(resolveDictionaryPath(payload, "setting.state.nope")).toBeUndefined();
      expect(resolveDictionaryPath(payload, "totally.invalid.path")).toBeUndefined();
      expect(resolveDictionaryPath(payload, "")).toBeUndefined();
    });

    it("trims surrounding whitespace from the path", () => {
      expect(resolveDictionaryPath(payload, "  setting.tool  ")).toEqual([{ id: 42, value: "Java" }]);
    });
  });
});
