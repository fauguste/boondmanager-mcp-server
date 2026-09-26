import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiDownload, apiUploadForm, formatDetailResponse, DownloadTooLargeError } from "../services/boond-client.js";
import { progressReporterFrom } from "../services/progress.js";
import { DocumentGetSchema, DocumentCreateSchema } from "../schemas/index.js";
import type { DocumentGetInput, DocumentCreateInput } from "../schemas/index.js";
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, CHARACTER_LIMIT } from "../constants.js";
import { registerDeleteTool, MutationOutputSchema } from "./crud-factory.js";
import { extractDocxText, extractPdfText, isDocxMime, isImageMime, isPdfMime } from "../services/document-text.js";
import type { ExtractedText } from "../services/document-text.js";

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
      description: `Télécharge un document BoondManager (CV de candidat/ressource, justificatif, contrat, facture...) par son ID, et le rend lisible : texte extrait pour un PDF ou un DOCX, contenu \`image\` (visible par le modèle) pour une image, texte brut pour un fichier texte.

Où trouver les IDs de documents : dans les onglets des entités — ex. boond_candidates_information expose les relations 'resumes' (CV) et 'files' (dossier administratif). ⚠️ Reprendre l'ID **tel quel**, suffixe compris (ex. '123_resume') : un ID tronqué à sa partie numérique ne désigne aucun document.

\`mode: "text"\` (défaut) : PDF / DOCX → texte extrait côté serveur (borné à ${CHARACTER_LIMIT} caractères, taille et nombre de pages d'origine indiqués) ; image PNG / JPEG / GIF / WebP → contenu \`image\` jusqu'à ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo. Un PDF scanné ou chiffré, dont rien ne s'extrait, est renvoyé tel quel avec un avertissement. \`mode: "raw"\` : le fichier tel quel en ressource embarquée (base64) — coûteux en contexte, à réserver aux cas où les octets sont nécessaires (transfert, format non géré). Taille max téléchargée : ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo.

Returns : texte extrait, contenu \`image\`, ou ressource embarquée (\`blob\` base64) selon le format et le mode.
Un ID inconnu est rejeté explicitement plutôt que de renvoyer la page d'accueil BoondManager, que l'API sert en HTTP 200 à la place d'un 404.`,
      inputSchema: DocumentGetSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: DocumentGetInput, extra: unknown) => {
      // Byte-level progress, but only when the client asked for it and the
      // response announces a Content-Length (see readDownloadBody). The size
      // cap is enforced *during* the download (#235): an announced size over
      // the cap is refused before the body is read, an unannounced one is cut
      // the moment it crosses it — never buffered whole and then refused.
      let doc;
      try {
        doc = await apiDownload(`/documents/${params.id}`, progressReporterFrom(extra), {
          maxBytes: MAX_DOCUMENT_BYTES,
        });
      } catch (err) {
        if (!(err instanceof DownloadTooLargeError)) throw err;
        const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
        const size = err.announced ? `${mb(err.bytes)} Mo` : `plus de ${mb(err.bytes)} Mo`;
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `❌ Document #${params.id} trop volumineux pour être retourné inline: ${size} (max ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo). Le téléchargement a été interrompu sans charger le fichier en mémoire.`,
            },
          ],
        };
      }
      const uri = `boond://documents/${params.id}`;
      const name = doc.filename ?? `document-${params.id}`;
      const sizeKb = (doc.data.length / 1024).toFixed(0);
      const header = `Document #${params.id} — ${name} (${doc.contentType}, ${sizeKb} Ko)`;

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

      const raw = (note?: string) => ({
        content: [
          {
            type: "text" as const,
            text: `${header}, contenu joint en ressource embarquée.${note ? `\n${note}` : ""}`,
          },
          {
            type: "resource" as const,
            resource: { uri, mimeType: doc.contentType, blob: doc.data.toString("base64") },
          },
        ],
      });

      if (params.mode === "raw") return raw();

      // Issue #263 — an image is handed to the model as `image` content, the
      // only shape hosts reliably pass to its vision input; a blob is opaque.
      if (isImageMime(doc.contentType)) {
        if (doc.data.length > MAX_IMAGE_BYTES) {
          return raw(
            `⚠️ Image de ${sizeKb} Ko, au-delà des ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo affichables en contenu \`image\` : renvoyée en ressource embarquée.`
          );
        }
        return {
          content: [
            { type: "text" as const, text: `${header} — image jointe.` },
            { type: "image" as const, data: doc.data.toString("base64"), mimeType: doc.contentType },
          ],
        };
      }

      // Issue #263 — a 5 MiB PDF is ~6.6 MB of base64 for a few KB of text.
      if (isPdfMime(doc.contentType) || isDocxMime(doc.contentType, doc.filename, doc.data)) {
        let extracted: ExtractedText;
        try {
          extracted = isPdfMime(doc.contentType) ? await extractPdfText(doc.data) : extractDocxText(doc.data);
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          return raw(`⚠️ Extraction du texte impossible (${why}) : fichier renvoyé tel quel.`);
        }
        const truncated = extracted.text.length > CHARACTER_LIMIT;
        const text = truncated ? extracted.text.substring(0, CHARACTER_LIMIT) : extracted.text;
        const pages = extracted.pages !== undefined ? `, ${extracted.pages} page(s)` : "";
        const cut = truncated
          ? `\n\n[Texte tronqué à ${CHARACTER_LIMIT} caractères sur ${extracted.text.length} — \`mode: "raw"\` pour le fichier complet.]`
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Document #${params.id} — ${name} (${doc.contentType}, ${sizeKb} Ko${pages}) — texte extrait :\n\n${text}${cut}`,
            },
          ],
        };
      }

      return raw();
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
      description: `Supprime définitivement un document (CV, justificatif, pièce jointe) de BoondManager.

⚠️ Irréversible, sans corbeille côté API. Si le client MCP annonce la capacité \`elicitation\`, une confirmation est demandée à l'utilisateur final et un refus annule l'appel.

Returns : \`{ id, deleted, reason? }\` — vérifier \`deleted\`, qui vaut \`false\` en cas de refus utilisateur.`,
    }
  );
}
