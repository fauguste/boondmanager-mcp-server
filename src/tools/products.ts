import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProductCreateSchema, ProductUpdateSchema } from "../schemas/index.js";
import {
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
  buildJsonApiBody,
} from "./crud-factory.js";

const OPTS = {
  entityName: "produit",
  entityNamePlural: "produits",
  apiPath: "/products",
  prefix: "boond_products",
};

export function registerProductTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, ProductCreateSchema, (params) => {
    const { ...attrs } = params;
    return buildJsonApiBody("product", attrs);
  });

  // Updates go through PUT /products/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124). buildJsonApiBody
  // drops undefined values, so PUT still only touches the supplied fields.
  registerUpdateTool(
    server,
    OPTS,
    ProductUpdateSchema,
    (params) => {
      const { id, ...attrs } = params;
      return buildJsonApiBody("product", attrs, id as string);
    },
    { method: "PUT", pathSuffix: "information" }
  );

  registerDeleteTool(server, OPTS);
}
