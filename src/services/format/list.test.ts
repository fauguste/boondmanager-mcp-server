import { describe, it, expect } from "vitest";
import { formatListResponse } from "./list.js";
import { CHARACTER_LIMIT } from "../../constants.js";

describe("formatListResponse", () => {
  it("should return message when no data", () => {
    const result = formatListResponse({ data: [] }, "candidat");
    expect(result).toBe("Aucun(e) candidat trouvé(e).");
  });

  it("should format single item", () => {
    const result = formatListResponse(
      {
        data: [{ id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } }],
      },
      "candidat"
    );
    expect(result).toContain("Jean Dupont");
  });

  it("should format multiple items", () => {
    const result = formatListResponse(
      {
        data: [
          { id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } },
          { id: "2", type: "candidate", attributes: { firstName: "Marie", lastName: "Martin" } },
        ],
      },
      "candidat"
    );
    expect(result).toContain("Jean Dupont");
    expect(result).toContain("Marie Martin");
  });

  it("should include total count when available", () => {
    const result = formatListResponse(
      {
        data: [{ id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } }],
        meta: { totals: { rows: 42 } },
      },
      "candidat"
    );
    expect(result).toContain("Total: 42");
  });

  it("should truncate when exceeding CHARACTER_LIMIT", () => {
    const longData = Array.from({ length: 5000 }, (_, i) => ({
      id: String(i),
      type: "candidate",
      attributes: { firstName: "Name".repeat(50), lastName: "Last".repeat(50) },
    }));
    const result = formatListResponse({ data: longData }, "candidat");
    expect(result.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(result).toContain("Résultats tronqués");
  });

  // Enriched fallback lines (date + type + note excerpt) are several times
  // longer than the bare `[type #id] | Statut: n` they replaced, so a large
  // page can now hit CHARACTER_LIMIT where it used to fit. Truncation must
  // then be honest and leave whole rows behind.
  describe("truncation", () => {
    const bigPage = (rows: number) =>
      Array.from({ length: rows }, (_, i) => ({
        id: String(i),
        type: "action",
        attributes: { startDate: "2026-08-03T10:00:00+0200", typeOf: 3, text: `<div>${"note ".repeat(60)}</div>` },
      }));

    it("cuts on line boundaries so no half-row is shown", () => {
      const result = formatListResponse({ data: bigPage(500), meta: { totals: { rows: 500 } } }, "action");
      const lines = result.split("\n").filter((l) => l.startsWith("[action #"));
      expect(lines.length).toBeGreaterThan(0);
      // Every rendered row is complete: the note excerpt ends with its quote.
      for (const line of lines) expect(line.endsWith('"')).toBe(true);
    });

    it("reports how many rows were kept out of how many were formatted", () => {
      const result = formatListResponse({ data: bigPage(500), meta: { totals: { rows: 500 } } }, "action");
      const shown = result.split("\n").filter((l) => l.startsWith("[action #")).length;
      expect(result).toContain(`[Résultats tronqués : ${shown}/500 ligne(s) affichée(s)`);
      expect(result).toContain("Total: 500 action(s)");
      expect(result.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    });

    it("still shows something when a single row exceeds the whole budget", () => {
      const result = formatListResponse(
        { data: [{ id: "1", type: "action", attributes: { reference: "R".repeat(CHARACTER_LIMIT * 2) } }] },
        "action"
      );
      expect(result).toContain("[action #1]");
      expect(result).toContain("Résultats tronqués : 0/1");
      expect(result.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    });
  });

  it("should handle non-array data (single object)", () => {
    const result = formatListResponse(
      {
        data: { id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } },
      },
      "candidat"
    );
    expect(result).toContain("Jean Dupont");
  });

  describe("fields projection", () => {
    const response = {
      data: [
        {
          id: "1",
          type: "candidate",
          attributes: { firstName: "Jean", lastName: "Dupont", title: "Dev", city: "Paris", skills: { main: "TS" } },
        },
      ],
      meta: { totals: { rows: 1 } },
    };

    it("restricts each line to the selected attributes", () => {
      const result = formatListResponse(response, "candidat", ["title", "city"]);
      expect(result).toContain("[#1]");
      expect(result).toContain("title: Dev");
      expect(result).toContain("city: Paris");
      expect(result).not.toContain("Jean");
    });

    it("silently skips unknown attribute names", () => {
      const result = formatListResponse(response, "candidat", ["title", "nope"]);
      expect(result).toContain("title: Dev");
      expect(result).not.toContain("nope");
    });

    it("JSON-serialises nested object values", () => {
      const result = formatListResponse(response, "candidat", ["skills"]);
      expect(result).toContain('skills: {"main":"TS"}');
    });

    // Observed on the real `/calendars` endpoint: 249 flat rows keyed on `iso`,
    // no `id` anywhere. The header used to render as `[#?]`.
    it("uses the [item] header for a flat row that has no id", () => {
      const result = formatListResponse({ data: [{ iso: "AD", value: "Andorre" }] as never }, "calendrier", ["value"]);
      expect(result).toBe("[item] | value: Andorre");
    });

    it("falls back to the standard summary when fields is empty", () => {
      const result = formatListResponse(response, "candidat", []);
      expect(result).toContain("Jean Dupont");
    });
  });
});

describe("formatListResponse — custom summary and empty windows (#243)", () => {
  it("renders 'aucun résultat' on data: null instead of crashing on [null]", () => {
    expect(formatListResponse({ data: null } as never, "feuille de temps")).toBe(
      "Aucun(e) feuille de temps trouvé(e)."
    );
    expect(formatListResponse({ data: undefined } as never, "feuille de temps")).toBe(
      "Aucun(e) feuille de temps trouvé(e)."
    );
  });

  it("uses the caller's per-row summary when one is given", () => {
    const response = {
      data: [
        { id: "1", type: "timesreport", attributes: { term: "2026-09" } },
        { id: "2", type: "timesreport", attributes: { term: "2026-10" } },
      ],
      meta: { totals: { rows: 2 } },
    };
    const summary = (e: { id: string; attributes: Record<string, unknown> }) => `CRA ${e.id} (${e.attributes.term})`;
    expect(formatListResponse(response as never, "feuille de temps", undefined, summary as never)).toBe(
      "Total: 2 feuille de temps(s)\n\nCRA 1 (2026-09)\nCRA 2 (2026-10)"
    );
  });

  it("lets `fields` take precedence over the custom summary", () => {
    const response = { data: [{ id: "1", type: "timesreport", attributes: { term: "2026-09", state: 3 } }] };
    const summary = () => "SHOULD NOT APPEAR";
    const text = formatListResponse(response as never, "feuille de temps", ["term"], summary as never);
    expect(text).not.toContain("SHOULD NOT APPEAR");
    expect(text).toContain("2026-09");
  });

  it("truncates a custom-summary page on line boundaries with the shown/total banner", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      type: "timesreport",
      attributes: { term: "2026-09" },
    }));
    const summary = (e: { id: string }) => `[timesreport #${e.id}] ${"x".repeat(200)}`;
    const text = formatListResponse({ data: rows } as never, "feuille de temps", undefined, summary as never);
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const shown = Number(/\[Résultats tronqués : (\d+)\/500/.exec(text)?.[1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(500);
    // Every kept row is whole: the line before the banner ends with the padding.
    const body = text.split("\n\n[Résultats tronqués")[0];
    for (const line of body.split("\n").slice(2)) expect(line.endsWith("x".repeat(200))).toBe(true);
  });
});
