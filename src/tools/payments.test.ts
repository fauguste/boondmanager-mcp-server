import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerPaymentTools } from "./payments.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerPaymentTools", {
  registrar: registerPaymentTools,
  namePrefix: "boond_payments",
  searchPath: "/payments",
});
