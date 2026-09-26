import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildFormBody, registerFormTools } from "./forms.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describe("registerFormTools (issue #256)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "70", type: "form", attributes: {} } } as never);
  });

  it("registers default, get and create", () => {
    registerFormTools(server);
    expect(registeredToolNames(server)).toEqual(["boond_forms_default", "boond_forms_get", "boond_forms_create"]);
  });

  it("default reads GET /forms/default?template=&resource=", async () => {
    registerFormTools(server);
    await toolCallback(server, "boond_forms_default")({ templateId: "3", resourceId: "18081" });
    expect(apiRequest).toHaveBeenCalledWith("/forms/default", "GET", undefined, { template: "3", resource: "18081" });
  });

  it("create POSTs template + dependsOn (resource or candidate) + validator / recipient relationships", async () => {
    registerFormTools(server);
    await toolCallback(
      server,
      "boond_forms_create"
    )({
      templateId: "3",
      candidateId: "42",
      validatorId: "18081",
      validateDate: "2026-10-15",
    });
    expect(apiRequest).toHaveBeenCalledWith("/forms", "POST", {
      data: {
        type: "form",
        attributes: { validateDate: "2026-10-15" },
        relationships: {
          template: { data: { id: "3", type: "formtemplate" } },
          dependsOn: { data: { id: "42", type: "candidate" } },
          validator: { data: { id: "18081", type: "resource" } },
        },
      },
    });
    expect(buildFormBody({ templateId: "3", resourceId: "9" })).toEqual({
      data: {
        type: "form",
        attributes: {},
        relationships: {
          template: { data: { id: "3", type: "formtemplate" } },
          dependsOn: { data: { id: "9", type: "resource" } },
        },
      },
    });
  });
});
