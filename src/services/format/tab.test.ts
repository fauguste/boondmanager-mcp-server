import { describe, it, expect } from "vitest";
import { formatDetailResponse } from "./detail.js";
import { formatTabResponse } from "./tab.js";

describe("formatTabResponse", () => {
  it("should list every entity when data is an array", () => {
    const result = formatTabResponse({
      data: [
        { id: "1", type: "positioning", attributes: { state: 1 } },
        { id: "2", type: "positioning", attributes: { state: 4 } },
        { id: "3", type: "positioning", attributes: { state: 9 } },
      ],
    });
    expect(result).toContain("3 élément(s)");
    const parsed = JSON.parse(result.substring(result.indexOf("[")));
    expect(parsed).toHaveLength(3);
    expect(parsed.map((e: { id: string }) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("should behave like formatDetailResponse for a single object", () => {
    const response = {
      data: { id: "1", type: "resource", attributes: { firstName: "Marie" } },
    };
    expect(formatTabResponse(response)).toBe(formatDetailResponse(response));
  });

  it("should report 0 élément(s) for an empty array", () => {
    const result = formatTabResponse({ data: [] });
    expect(result).toContain("0 élément(s)");
  });
});
