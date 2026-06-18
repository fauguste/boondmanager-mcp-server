import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerCalendarTools } from "./calendars.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerCalendarTools", {
  registrar: registerCalendarTools,
  namePrefix: "boond_calendars",
  searchPath: "/calendars",
});
