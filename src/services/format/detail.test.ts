import { describe, it, expect } from "vitest";
import { formatDetailResponse } from "./detail.js";

describe("formatDetailResponse", () => {
  it("should return JSON with id, type, attributes, relationships", () => {
    const result = formatDetailResponse({
      data: {
        id: "1",
        type: "candidate",
        attributes: { firstName: "Jean" },
        relationships: { company: { data: { id: "10", type: "company" } } },
      },
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("1");
    expect(parsed.type).toBe("candidate");
    expect(parsed.attributes.firstName).toBe("Jean");
    expect(parsed.relationships.company.data.id).toBe("10");
  });

  it("should return message when entity is not found", () => {
    const result = formatDetailResponse({ data: [] });
    expect(result).toBe("Entité non trouvée.");
  });

  it("should handle data as single object (not array)", () => {
    const result = formatDetailResponse({
      data: { id: "1", type: "resource", attributes: { firstName: "Marie" } },
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("1");
  });

  it("should truncate when exceeding CHARACTER_LIMIT", () => {
    const largeAttrs: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) {
      largeAttrs[`field${i}`] = "x".repeat(50);
    }
    const result = formatDetailResponse({
      data: { id: "1", type: "test", attributes: largeAttrs },
    });
    expect(result).toContain("[Résultat tronqué...]");
  });
});
