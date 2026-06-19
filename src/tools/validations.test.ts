import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerValidationTools } from "./validations.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerValidationTools", {
  registrar: registerValidationTools,
  namePrefix: "boond_validations",
  searchPath: "/validations",
});
