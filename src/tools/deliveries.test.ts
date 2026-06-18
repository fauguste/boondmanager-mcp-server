import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerDeliveryTools } from "./deliveries.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerDeliveryTools", {
  registrar: registerDeliveryTools,
  namePrefix: "boond_deliveries",
  searchPath: "/deliveries-groupments",
  getPath: (id) => `/deliveries/${id}`,
});
