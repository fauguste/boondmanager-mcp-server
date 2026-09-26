import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTabTools, type TabDefinition } from "./tab-tools.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

const OPTS = {
  entityName: "candidat",
  entityNamePlural: "candidats",
  apiPath: "/candidates",
  prefix: "boond_candidates",
};
const TABS: TabDefinition[] = [
  {
    name: "technical_data",
    tab: "technical-data",
    title: "Profil technique d'un candidat",
    subject: "le profil technique",
    content: "compétences, outils",
    returns: "Le profil technique.",
    behaviour: ["Les CV sont dans `resumes`."],
  },
  { name: "actions", tab: "actions", title: "Actions", subject: "les actions", returns: "Liste des actions." },
];

describe("registerTabTools", () => {
  let server: McpServer;
  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    vi.mocked(apiRequest).mockReset();
    registerTabTools(server, OPTS, TABS);
  });

  const registration = (name: string) => vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)!;

  it("registers one read-only, idempotent tool per tab, named `{prefix}_{name}`", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    for (const name of ["boond_candidates_technical_data", "boond_candidates_actions"]) {
      const [, config] = registration(name);
      expect(config.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(config.title).toBeDefined();
    }
  });

  it("composes the description from the template: subject, content, behaviour, sibling, Returns", () => {
    const [, config] = registration("boond_candidates_technical_data");
    const description = config.description ?? "";
    expect(description).toContain("le profil technique");
    expect(description).toContain("compétences, outils");
    expect(description).toContain("Les CV sont dans `resumes`.");
    expect(description).toContain("boond_candidates_get");
    expect(description).toMatch(/^Returns\s*:/m);
  });

  it("the handler reads `{apiPath}/{id}/{tab}` with the API's spelling of the tab and renders every row", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [
        { id: "1", type: "action", attributes: { title: "Appel" } },
        { id: "2", type: "action", attributes: { title: "Mail" } },
      ],
    } as never);
    const [, , handler] = registration("boond_candidates_technical_data");
    const result = await (handler as (p: unknown) => Promise<{ content: Array<{ text: string }> }>)({ id: "42" });
    expect(apiRequest).toHaveBeenCalledWith("/candidates/42/technical-data");
    expect(result.content[0].text).toContain("2 élément(s)");
    expect(result.content[0].text).toContain("Mail");
  });

  it("a single-entity tab renders as a detail", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: { id: "42", type: "candidate", attributes: { firstName: "Jean" } },
    } as never);
    const [, , handler] = registration("boond_candidates_actions");
    const result = await (handler as (p: unknown) => Promise<{ content: Array<{ text: string }> }>)({ id: "42" });
    expect(apiRequest).toHaveBeenCalledWith("/candidates/42/actions");
    expect(result.content[0].text).toContain('"firstName": "Jean"');
  });
});
