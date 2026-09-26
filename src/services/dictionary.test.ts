import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as boondClient from "./boond-client.js";
import { oauthContext } from "./oauth.js";
import { currentRequestSignal, runWithRequestSignal } from "./request-context.js";
import {
  MAX_DICTIONARY_CACHE_ENTRIES,
  currentAuthIdentity,
  dictionaryCacheSizeForTests,
  getDictionary,
  resolveDictionaryPath,
  resetDictionaryCacheForTests,
} from "./dictionary.js";

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

  describe("cache isolation by auth identity and language (#226)", () => {
    const fr = { data: { setting: { lang: "fr" } } };
    const en = { data: { setting: { lang: "en" } } };

    function mockByLanguage() {
      return vi
        .spyOn(boondClient, "apiRequest")
        .mockImplementation(
          async (_path, _method, _body, query) =>
            ((query as { language?: string } | undefined)?.language === "en" ? en : fr) as never
        );
    }

    it("reports a constant identity outside an OAuth request context (stdio / static auth)", () => {
      expect(currentAuthIdentity()).toBe("env");
    });

    it("derives the identity from a hash of the OAuth token, never the token itself", () => {
      const id = oauthContext.run({ accessToken: "secret-token-A" }, () => currentAuthIdentity());
      expect(id).toMatch(/^oauth:[0-9a-f]{64}$/);
      expect(id).not.toContain("secret-token-A");
      const again = oauthContext.run({ accessToken: "secret-token-A" }, () => currentAuthIdentity());
      expect(again).toBe(id);
      const other = oauthContext.run({ accessToken: "secret-token-B" }, () => currentAuthIdentity());
      expect(other).not.toBe(id);
    });

    it("does not serve tenant A's dictionary to a request carrying tenant B's token", async () => {
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValueOnce({ data: { setting: { tenant: "A" } } } as never)
        .mockResolvedValueOnce({ data: { setting: { tenant: "B" } } } as never);

      const a = await oauthContext.run({ accessToken: "token-A" }, () => getDictionary());
      const b = await oauthContext.run({ accessToken: "token-B" }, () => getDictionary());

      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(a.payload).toEqual({ data: { setting: { tenant: "A" } } });
      expect(b.payload).toEqual({ data: { setting: { tenant: "B" } } });

      // Each identity keeps its own entry: a second read for A is a hit on A's payload.
      const aAgain = await oauthContext.run({ accessToken: "token-A" }, () => getDictionary());
      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(aAgain).toBe(a);
    });

    it("isolates the OAuth entries from the env identity", async () => {
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValueOnce({ data: { setting: { who: "env" } } } as never)
        .mockResolvedValueOnce({ data: { setting: { who: "oauth" } } } as never);
      const env = await getDictionary();
      const oauth = await oauthContext.run({ accessToken: "token" }, () => getDictionary());
      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(env.payload).not.toEqual(oauth.payload);
    });

    it("keeps one entry per language for the same identity instead of thrashing", async () => {
      const apiSpy = mockByLanguage();
      await getDictionary({ language: "fr" });
      await getDictionary({ language: "en" });
      const fr2 = await getDictionary({ language: "fr" });
      const en2 = await getDictionary({ language: "en" });
      // Two languages, two fetches — the fr entry survived the en fetch.
      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(fr2.payload).toEqual(fr);
      expect(en2.payload).toEqual(en);
    });

    it("does not answer a concurrent `en` request with the `fr` payload still in flight", async () => {
      const resolvers: Array<{ language: string; resolve: (v: unknown) => void }> = [];
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockImplementation(
        (_path, _method, _body, query) =>
          new Promise((resolve) => {
            resolvers.push({ language: (query as { language: string }).language, resolve });
          })
      );
      const pFr = getDictionary({ language: "fr" });
      const pEn = getDictionary({ language: "en" });
      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(resolvers.map((r) => r.language)).toEqual(["fr", "en"]);
      resolvers[0]!.resolve(fr);
      resolvers[1]!.resolve(en);
      const [rFr, rEn] = await Promise.all([pFr, pEn]);
      expect(rFr.language).toBe("fr");
      expect(rFr.payload).toEqual(fr);
      expect(rEn.language).toBe("en");
      expect(rEn.payload).toEqual(en);
    });

    it("still deduplicates concurrent fetches for the same identity and language", async () => {
      let resolve!: (v: unknown) => void;
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockImplementation(
        () =>
          new Promise((res) => {
            resolve = res;
          })
      );
      const run = () => oauthContext.run({ accessToken: "token-A" }, () => getDictionary());
      const p1 = run();
      const p2 = run();
      resolve(fr);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(apiSpy).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2);
    });

    it("bounds the cache to MAX_DICTIONARY_CACHE_ENTRIES, evicting the least recently used", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue(fr as never);
      const read = (n: number) => oauthContext.run({ accessToken: `token-${n}` }, () => getDictionary());

      for (let i = 0; i < MAX_DICTIONARY_CACHE_ENTRIES; i++) await read(i);
      expect(dictionaryCacheSizeForTests()).toBe(MAX_DICTIONARY_CACHE_ENTRIES);

      // Touch entry 0 so it becomes the most recently used, then overflow by one.
      await read(0);
      await read(MAX_DICTIONARY_CACHE_ENTRIES);
      expect(dictionaryCacheSizeForTests()).toBe(MAX_DICTIONARY_CACHE_ENTRIES);

      const before = apiSpy.mock.calls.length;
      await read(0); // survived (recently used) → hit
      expect(apiSpy.mock.calls.length).toBe(before);
      await read(1); // oldest untouched → evicted → refetch
      expect(apiSpy.mock.calls.length).toBe(before + 1);
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

describe("dictionary load is detached from the caller's cancellation (#231)", () => {
  beforeEach(() => {
    resetDictionaryCacheForTests();
    vi.restoreAllMocks();
  });

  it("loads inside a cancelled request context and serves every waiter", async () => {
    // Two requests await the same in-flight load (#226). If the load ran
    // under the first caller's signal, cancelling that caller would reject
    // the dictionary for the second one as well.
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockImplementation(async () => {
      expect(currentRequestSignal()).toBeUndefined();
      return { data: { setting: {} } } as never;
    });
    const controller = new AbortController();
    controller.abort();
    const first = runWithRequestSignal(controller.signal, () => getDictionary());
    const second = getDictionary();
    await expect(first).resolves.toMatchObject({ language: "fr" });
    await expect(second).resolves.toMatchObject({ language: "fr" });
    expect(apiSpy).toHaveBeenCalledTimes(1);
  });
});
