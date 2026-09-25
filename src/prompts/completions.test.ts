import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCompleter, isCompletable } from "@modelcontextprotocol/sdk/server/completable.js";
import { PROMPTS, completeEntityArgument } from "./index.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", () => ({ apiRequest: vi.fn() }));

/**
 * Issue #260 — `completions/complete` on the entity arguments. The arguments
 * accept a label ("Jean Dupont", "ACME"), so the completer returns labels the
 * runbook's resolution step then turns into an id.
 */
describe("prompt argument completions (#260)", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  it("every *_id argument of every prompt carries a completer", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const p of PROMPTS) {
      for (const [arg, schema] of Object.entries(p.argsSchema)) {
        if (!arg.endsWith("_id")) continue;
        seen++;
        if (!isCompletable(schema)) missing.push(`${p.name}.${arg}`);
      }
    }
    expect(missing).toEqual([]);
    expect(seen).toBeGreaterThan(8);
  });

  it("completes a manager by searching resources on the typed prefix and returning names", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [
        { id: "1", type: "resource", attributes: { firstName: "Jean", lastName: "Dupont" } },
        { id: "2", type: "resource", attributes: { firstName: "Jeanne", lastName: "Durand" } },
        { id: "3", type: "resource", attributes: { firstName: "Jean", lastName: "Dupont" } },
      ],
    } as never);
    const schema = PROMPTS.find((p) => p.name === "synthese_equipe")!.argsSchema.manager_id;
    const values = await getCompleter(schema)!("Jea");
    expect(apiRequest).toHaveBeenCalledWith("/resources", "GET", undefined, { keywords: "Jea", maxResults: 8 });
    expect(values).toEqual(["Jean Dupont", "Jeanne Durand"]);
  });

  it("routes society / opportunity / agency / project arguments to their own search", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [{ id: "9", type: "company", attributes: { name: "ACME" } }],
    } as never);
    expect(await completeEntityArgument("society", "AC")).toEqual(["ACME"]);
    expect(apiRequest).toHaveBeenLastCalledWith("/companies", "GET", undefined, { keywords: "AC", maxResults: 8 });
    vi.mocked(apiRequest).mockResolvedValue({
      data: [{ id: "9", type: "opportunity", attributes: { title: "Refonte SI" } }],
    } as never);
    expect(await completeEntityArgument("opportunity", "Ref")).toEqual(["Refonte SI"]);
    expect(apiRequest).toHaveBeenLastCalledWith("/opportunities", "GET", undefined, expect.anything());
    await completeEntityArgument("agency", "Pa");
    expect(apiRequest).toHaveBeenLastCalledWith("/agencies", "GET", undefined, expect.anything());
    await completeEntityArgument("project", "Re");
    expect(apiRequest).toHaveBeenLastCalledWith("/projects", "GET", undefined, expect.anything());
  });

  it("returns nothing on an empty prefix (no API call) and on any API failure", async () => {
    expect(await completeEntityArgument("resource", "   ")).toEqual([]);
    expect(apiRequest).not.toHaveBeenCalled();
    vi.mocked(apiRequest).mockRejectedValue(new Error("no credentials"));
    expect(await completeEntityArgument("resource", "Jean")).toEqual([]);
  });

  it("leaves the advertised argument schema untouched (mirror workflow tools keep their JSON Schema)", () => {
    const schema = PROMPTS.find((p) => p.name === "factures_a_relancer")!.argsSchema.society_id;
    expect(Object.keys(schema)).not.toContain("complete");
    expect(schema.safeParse("ACME").success).toBe(true);
  });
});
