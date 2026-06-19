import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerAgencyTools } from "./agencies.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerAgencyTools", {
  registrar: registerAgencyTools,
  namePrefix: "boond_agencies",
  searchPath: "/agencies",
});
