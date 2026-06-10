import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiDownload, apiUploadForm, formatDetailResponse } from "../services/boond-client.js";
import { IdSchema, DocumentCreateSchema } from "../schemas/index.js";
import type { IdInput, DocumentCreateInput } from "../schemas/index.js";
import { MAX_DOCUMENT_BYTES, CHARACTER_LIMIT } from "../constants.js";
import { registerDeleteTool, MutationOutputSchema } from "./crud-factory.js";

/** Mime types rendered as plain text instead of a base64 blob. */
function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || /[+/](json|xml)$|^application\/(json|xml|csv)$/.test(mime);
}

export function registerDocumentTools(server: McpServer): void {
  // Download a document (CV, justificatif, contrat...)
  server.registerTool(
    "boond_documents_get",
    {
      title: "Télécharger un document",
      description: `Télécharge le contenu d'un document BoondManager (CV de candidat/ressource, justificatif, contrat, facture...) par son ID.

Où trouver les IDs de documents : dans les onglets des entités — ex. boond_candidates_information expose les relations 'resumes' (CV) et 'files' (dossier administratif).

Le contenu est retourné en ressource MCP embarquée (base64 pour les binaires type PDF/DOCX, texte brut pour les fichiers texte). Taille max: ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo — à n'utiliser que lorsque le contenu du fichier est réellement nécessaire (un CV en base64 occupe beaucoup de contexte).

Args:
  - id (string): Identifiant du document`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: IdInput) => {
      const doc = await apiDownload(`/documents/${params.id}`);
      const uri = `boond://documents/${params.id}`;
      const name = doc.filename ?? `document-${params.id}`;

      if (doc.data.length > MAX_DOCUMENT_BYTES) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `❌ Document #${params.id} (${name}) trop volumineux pour être retourné inline: ${(doc.data.length / 1024 / 1024).toFixed(1)} Mo (max ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo).`,
            },
          ],
        };
      }

      if (isTextMime(doc.contentType)) {
        let text = doc.data.toString("utf8");
        if (text.length > CHARACTER_LIMIT) {
          text = text.substring(0, CHARACTER_LIMIT) + "\n\n[Contenu tronqué...]";
        }
        return {
          content: [
            { type: "text" as const, text: `Document #${params.id} — ${name} (${doc.contentType})\n\n${text}` },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Document #${params.id} — ${name} (${doc.contentType}, ${(doc.data.length / 1024).toFixed(0)} Ko), contenu joint en ressource embarquée.`,
          },
          {
            type: "resource" as const,
            resource: {
              uri,
              mimeType: doc.contentType,
              blob: doc.data.toString("base64"),
            },
          },
        ],
      };
    }
  );

  // Upload a document by URL
  server.registerTool(
    "boond_documents_create",
    {
      title: "Téléverser un document",
      description: `Attache un document à une entité BoondManager à partir d'une URL (l'API BoondManager télécharge elle-même le fichier — aucun fichier local n'est lu).

Cas d'usage typiques : attacher un CV à un candidat (parentType=candidateResume, parsing=true pour lancer l'analyse IA Boond), joindre un justificatif à une note de frais (expensesReport), un document à un projet/une société...

Returns: Métadonnées du document créé (ID).`,
      inputSchema: DocumentCreateSchema,
      outputSchema: MutationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: DocumentCreateInput) => {
      const fields: Record<string, string> = {
        parentType: params.parentType,
        parentId: String(params.parentId),
        fileUrl: params.fileUrl,
      };
      if (params.parsing !== undefined) fields.parsing = String(params.parsing);
      const response = await apiUploadForm("/documents", fields);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      const structured: { id?: string; type?: string } = {};
      if (entity?.id !== undefined) structured.id = String(entity.id);
      if (entity?.type !== undefined) structured.type = String(entity.type);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Document créé avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
        structuredContent: structured,
      };
    }
  );

  // Delete a document — factory: élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    { entityName: "document", entityNamePlural: "documents", apiPath: "/documents", prefix: "boond_documents" },
    {
      title: "Supprimer un document",
      description: `Supprime un document de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
    }
  );
}
