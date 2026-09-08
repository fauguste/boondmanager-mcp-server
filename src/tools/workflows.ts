import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PROMPTS } from "../prompts/index.js";
import { isDomainAllowed, type AccessPolicy } from "../config/access-policy.js";
import { composeDescription } from "./description-builders.js";

/**
 * Workflow tools — same runbooks as the MCP prompts in `src/prompts/index.ts`,
 * but exposed via `tools/list` instead of `prompts/list`.
 *
 * Why both? Some MCP clients (notably claude.ai's "Cowork" connector menu)
 * mishandle the `prompts/get` response: instead of injecting the returned
 * user message into the conversation, they treat it as a virtual file
 * attachment named `{prompt_name}_text` and the model then tries to `Read`
 * it from the uploads folder, finds nothing, and asks the user to upload
 * the file. Tools, on the other hand, are universally well-supported:
 * the result content is fed back into the model the same way as any
 * other tool call.
 *
 * Implementation: each prompt is mirrored 1:1 as a tool that calls the
 * same `build()` function. Tool name pattern: `boond_workflow_{prompt_name}`.
 * Same args, same output. The runbook returned in the tool result is
 * exactly the text the prompt would have produced.
 */
export function registerWorkflowTools(server: McpServer, policy?: AccessPolicy): void {
  for (const p of PROMPTS) {
    // Mirror the prompt-level domain filter: cut a workflow tool when any
    // domain its source prompt orchestrates is filtered out (keeps the
    // workflow tools and the MCP prompts perfectly in sync).
    if (policy && !p.domains.every((d) => isDomainAllowed(policy, d))) continue;
    server.registerTool(
      `boond_workflow_${p.name}`,
      {
        title: p.title,
        description: composeDescription({
          purpose: p.description,
          when: "pour dérouler ce scénario multi-étapes sans avoir à retrouver soi-même le bon enchaînement d'outils et les bons noms de filtres.",
          instead:
            `le prompt MCP \`${p.name}\` si le client l'expose — contenu identique, ` +
            "sans consommer un appel d'outil. Cette variante existe pour les clients qui " +
            "traitent mal `prompts/get` (claude.ai notamment).",
          behaviour: [
            "N'appelle aucune API BoondManager et ne lit aucune donnée : la réponse est générée côté serveur MCP.",
          ],
          returns:
            "un runbook en texte — la liste ordonnée des appels Boond à effectuer, avec les filtres exacts. " +
            "C'est ensuite au modèle de les exécuter ; rien n'est fait par cet appel.",
        }),
        inputSchema: p.argsSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (params) => {
        const text = p.build((params ?? {}) as Record<string, string | undefined>);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
