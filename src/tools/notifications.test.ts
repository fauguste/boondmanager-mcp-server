import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerNotificationTools } from "./notifications.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerNotificationTools", {
  registrar: registerNotificationTools,
  namePrefix: "boond_notifications",
  searchPath: "/notifications",
});
