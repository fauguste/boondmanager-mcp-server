import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerBusinessUnitTools } from "./business-units.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerBusinessUnitTools", {
  registrar: registerBusinessUnitTools,
  namePrefix: "boond_business_units",
  searchPath: "/business-units",
});
