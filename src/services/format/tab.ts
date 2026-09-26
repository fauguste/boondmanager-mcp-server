/**
 * Rendering of an entity-tab endpoint (`/resources/{id}/positionings`…).
 */
import { CHARACTER_LIMIT } from "../../constants.js";
import type { JsonApiResponse } from "../../types.js";
import { formatDetailResponse, projectEntity } from "./detail.js";

/**
 * Formate la réponse d'un endpoint d'onglet (ex: /resources/{id}/positionings).
 * Contrairement à formatDetailResponse, un tableau est restitué en entier :
 * certains onglets renvoient plusieurs entités (positionnements, contacts...)
 * et n'afficher que la première masquait les autres.
 */
export function formatTabResponse(response: JsonApiResponse): string {
  if (!Array.isArray(response.data)) {
    return formatDetailResponse(response);
  }

  const entities = response.data.map(projectEntity);

  let result = `${entities.length} élément(s)\n\n` + JSON.stringify(entities, null, 2);

  if (result.length > CHARACTER_LIMIT) {
    result = result.substring(0, CHARACTER_LIMIT) + "\n\n[Résultat tronqué...]";
  }

  return result;
}
