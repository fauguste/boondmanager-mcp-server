import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerLogTools } from "./logs.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerLogTools", {
  registrar: registerLogTools,
  namePrefix: "boond_logs",
  searchPath: "/logs",
});
