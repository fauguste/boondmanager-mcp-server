import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerAdvantageTools } from "./advantages.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerAdvantageTools", {
  registrar: registerAdvantageTools,
  namePrefix: "boond_advantages",
  searchPath: "/advantages",
});
