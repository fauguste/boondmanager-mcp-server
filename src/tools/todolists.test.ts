import { vi } from "vitest";
import { describeSearchGetTools } from "./test-helpers.js";
import { registerTodolistTools } from "./todolists.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describeSearchGetTools("registerTodolistTools", {
  registrar: registerTodolistTools,
  namePrefix: "boond_todolists",
  searchPath: "/todolists",
});
