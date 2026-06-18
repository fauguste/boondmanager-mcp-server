import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerThreadTools } from "./threads.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerThreadTools", {
  registrar: registerThreadTools,
  namePrefix: "boond_threads",
  searchPath: "/threads",
});
