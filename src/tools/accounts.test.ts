import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerAccountTools } from "./accounts.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerAccountTools", {
  registrar: registerAccountTools,
  namePrefix: "boond_accounts",
  searchPath: "/accounts",
});
