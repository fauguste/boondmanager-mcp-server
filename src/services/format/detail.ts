/**
 * Rendering of a single entity: the canonical projection (`projectEntity`) and
 * its pretty-printed, `CHARACTER_LIMIT`-bounded text form.
 */
import { CHARACTER_LIMIT } from "../../constants.js";
import type { JsonApiResource, JsonApiResponse } from "../../types.js";

/**
 * The canonical shape of a single entity as this server hands it to the model:
 * the JSON:API resource minus the envelope noise (`links`, `meta`).
 *
 * Extracted from `formatDetailResponse` so the entity resource templates
 * (`boond://candidate/{id}`) aggregate the *same* projection instead of
 * defining a second, drifting idea of what an entity looks like. They cannot
 * reuse `formatDetailResponse` itself: it renders one entity and truncates
 * mid-string at `CHARACTER_LIMIT`, which on pretty-printed JSON yields an
 * unparseable body — acceptable for a tool's text content, not for a resource
 * whose whole point is to be read as JSON.
 */
export function projectEntity(
  entity: JsonApiResource
): Pick<JsonApiResource, "id" | "type" | "attributes" | "relationships"> {
  return {
    id: entity.id,
    type: entity.type,
    attributes: entity.attributes,
    ...(entity.relationships !== undefined ? { relationships: entity.relationships } : {}),
  };
}

export function formatDetailResponse(response: JsonApiResponse): string {
  const entity = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!entity) return "Entité non trouvée.";

  const result = JSON.stringify(projectEntity(entity), null, 2);

  if (result.length > CHARACTER_LIMIT) {
    return result.substring(0, CHARACTER_LIMIT) + "\n\n[Résultat tronqué...]";
  }

  return result;
}
