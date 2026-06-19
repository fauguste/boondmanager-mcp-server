import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerPoleTools } from "./poles.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerPoleTools", {
  registrar: registerPoleTools,
  namePrefix: "boond_poles",
  searchPath: "/poles",
});
