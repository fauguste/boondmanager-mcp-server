import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerWebhookTools } from "./webhooks.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerWebhookTools", {
  registrar: registerWebhookTools,
  namePrefix: "boond_webhooks",
  searchPath: "/webhooks",
});
