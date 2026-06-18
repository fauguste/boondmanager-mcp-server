import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerRoleTools } from "./roles.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerRoleTools", {
  registrar: registerRoleTools,
  namePrefix: "boond_roles",
  searchPath: "/roles",
});
