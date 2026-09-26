import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildTodolistBody, registerTodolistTools } from "./todolists.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

describe("registerTodolistTools", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiSearch).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "3", type: "todolist", attributes: {} } } as never);
    vi.mocked(apiSearch).mockResolvedValue({ data: [] } as never);
  });

  it("registers search, get, create and the per-record tasks reader (#254)", () => {
    registerTodolistTools(server);
    expect(registeredToolNames(server)).toEqual([
      "boond_todolists_search",
      "boond_todolists_get",
      "boond_todolists_create",
      "boond_tasks_get",
    ]);
  });

  it("search and get keep the standard read paths", async () => {
    registerTodolistTools(server);
    await toolCallback(server, "boond_todolists_search")({ page: 1, pageSize: 10 });
    expect(vi.mocked(apiSearch).mock.calls[0]?.[0]).toBe("/todolists");
    await toolCallback(server, "boond_todolists_get")({ id: "3" });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toBe("/todolists/3");
  });

  it("create POSTs the title, the ordered tasks and the agencies relationship on /todolists", async () => {
    registerTodolistTools(server);
    await toolCallback(
      server,
      "boond_todolists_create"
    )({
      title: "Onboarding consultant",
      profile: "resource",
      agencyIds: ["3"],
      tasks: [
        { description: "Badge", row: 0 },
        { description: "Laptop", row: 1 },
      ],
    });
    expect(apiRequest).toHaveBeenCalledWith("/todolists", "POST", {
      data: {
        type: "todolist",
        attributes: {
          title: "Onboarding consultant",
          profile: "resource",
          tasks: [
            { description: "Badge", row: 0 },
            { description: "Laptop", row: 1 },
          ],
        },
        relationships: { agencies: { data: [{ id: "3", type: "agency" }] } },
      },
    });
    expect(buildTodolistBody({ title: "x", tasks: [] })).toEqual({
      data: { type: "todolist", attributes: { title: "x", tasks: [] } },
    });
  });

  it("tasks_get reads GET /{entity}/{id}/tasks for the fourteen entities", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [{ id: "1", type: "task", attributes: { description: "Badge", state: 0 } }],
    } as never);
    registerTodolistTools(server);
    const result = (await toolCallback(server, "boond_tasks_get")({ entity: "contract", id: "3900" })) as {
      content: Array<{ text: string }>;
    };
    expect(apiRequest).toHaveBeenCalledWith("/contracts/3900/tasks");
    expect(result.content[0]?.text).toContain("Badge");
    const schema = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_tasks_get")?.[1]
      .inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ entity: "payment", id: "1" }).success).toBe(true);
    expect(schema.safeParse({ entity: "form", id: "1" }).success).toBe(true);
    expect(schema.safeParse({ entity: "agency", id: "1" }).success).toBe(false);
  });
});
