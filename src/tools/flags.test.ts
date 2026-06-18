import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerFlagTools } from "./flags.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerFlagTools", {
  registrar: registerFlagTools,
  namePrefix: "boond_flags",
  searchPath: "/flags",
});
