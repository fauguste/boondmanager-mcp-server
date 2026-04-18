# CLAUDE.md - BoondManager MCP Server

## Project Overview

MCP (Model Context Protocol) server for the BoondManager API. Exposes 158 tools across 36 domains, allowing Claude to interact with BoondManager ERP/CRM data.

- **Language**: TypeScript (strict mode), ES2022, Node16 module resolution
- **Runtime**: Node.js >= 20
- **Transports**: stdio (default, no network port) and Streamable HTTP (MCP 2025-03-26, for gateways/remote)
- **API format**: JSON:API (BoondManager REST API)

## Commands

```bash
npm run build          # TypeScript compilation (tsc)
npm run dev            # Watch mode (tsc --watch)
npm start              # Run server (node dist/index.js)
npm test               # Run all tests (vitest run)
npm run test:coverage  # Tests + V8 coverage
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run typecheck      # tsc --noEmit
```

Run a single test file:
```bash
npx vitest run src/tools/candidates.test.ts
```

## Architecture

```
src/
├── index.ts              # Entry point: initClient(), selects transport (stdio or http) via MCP_TRANSPORT
├── server.ts             # createMcpServer() factory — instantiates McpServer + registers all tools
├── constants.ts          # DEFAULT_BASE_URL, pagination limits, API_PATHS, ENTITY_TABS
├── types.ts              # JsonApiResource, JsonApiResponse, BoondConfig, SearchParams
├── transports/
│   └── http.ts           # startHttpTransport() + resolveHttpOptions() — MCP Streamable HTTP server
├── services/
│   └── boond-client.ts   # HTTP client: apiRequest(), buildSearchQuery(), formatListResponse(), formatDetailResponse()
├── schemas/
│   └── index.ts          # Zod schemas: SearchSchema, IdSchema, IdTabSchema, plus entity-specific create/update schemas
└── tools/
    ├── index.ts          # Barrel export of all register*Tools functions
    ├── crud-factory.ts   # Generic CRUD tool factory (registerSearchTool, registerGetTool, etc.)
    └── *.ts              # One file per domain (37 tool files)
```

### Key Patterns

**CRUD Factory** (`crud-factory.ts`): Generic functions to register search/get/create/update/delete tools. Used by: candidates, resources, contacts, companies, opportunities, projects, products. Call signature: `registerSearchTool(server, opts)` where `opts = { entityName, entityNamePlural, apiPath, prefix }`.

**Tab tools**: Major entities (candidates, resources, contacts, companies, opportunities, projects) register additional tools for each tab endpoint. These are registered in loops over `ENTITY_TABS[entity]` from constants.ts. Tool name pattern: `boond_{entity}_{tab_name}` (hyphens replaced with underscores).

**Simple domains**: Most admin/reference domains (accounts, agencies, roles, etc.) register only search + get with direct `server.registerTool()` calls.

**JSON:API body builder**: `buildJsonApiBody(type, attributes, id?)` in crud-factory.ts builds the `{ data: { type, attributes } }` payload. Filters out undefined values.

## Tool Naming Convention

All tool names follow: `boond_{domain}_{operation}`

- Operations: `search`, `get`, `create`, `update`, `delete`
- Tab tools: `boond_{entity}_{tab_name}` (e.g., `boond_resources_technical_data`)
- Reporting: `boond_reporting_{type}` (e.g., `boond_reporting_companies`)
- Application: `boond_application_dictionary`, `boond_application_current_user`

## Testing

- **Framework**: Vitest 4 (with `globals: true`)
- **Pattern**: Each tool file has a corresponding `.test.ts` file
- **Approach**: Mock `McpServer` with `{ registerTool: vi.fn() }`, then verify:
  1. Correct number of `registerTool` calls
  2. Correct tool names
  3. Correct MCP annotations (readOnlyHint, destructiveHint, idempotentHint)
- **Coverage**: V8 provider, excludes test files and index.ts
- **Current stats**: 40 test files, 255 tests

### Test file template (for read-only search+get domains):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerXxxTools } from "./xxx.js";

function createMockServer() {
  return { registerTool: vi.fn() } as unknown as McpServer;
}

describe("registerXxxTools", () => {
  let server: McpServer;
  beforeEach(() => { server = createMockServer(); });

  it("should register N tools", () => {
    registerXxxTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(N);
  });

  it("should register all expected tool names", () => {
    registerXxxTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_xxx_search");
    expect(names).toContain("boond_xxx_get");
  });

  it("should register all tools as readOnly", () => {
    registerXxxTools(server);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });
});
```

## Adding a New Domain

1. Create `src/tools/{domain}.ts` with a `register{Domain}Tools(server: McpServer)` function
2. For simple search+get: use direct `server.registerTool()` calls with `SearchSchema`/`IdSchema`
3. For full CRUD: use `crud-factory.ts` functions or direct registration
4. Export from `src/tools/index.ts`
5. Register in `src/index.ts`
6. Add API path to `API_PATHS` in `constants.ts` (if applicable)
7. Create `src/tools/{domain}.test.ts` following the test pattern above
8. Run `npm test && npm run lint && npm run typecheck && npm run build`

## MCP Annotations

Every tool must declare annotations:
- `readOnlyHint: true` for search/get operations
- `destructiveHint: true` for delete operations
- `idempotentHint: true` for search/get/update operations
- `openWorldHint: true` for search operations (paginated, keyword-filtered)

## Transports

The server selects its transport from `MCP_TRANSPORT`:

- **`stdio`** (default): wraps `StdioServerTransport`, used by Claude Desktop / Claude Code locally.
- **`http`** (alias: `streamable-http`): starts a Node HTTP server using `StreamableHTTPServerTransport` from the MCP SDK. Intended for MCP gateways and remote deployments.

HTTP env vars (see `src/transports/http.ts::resolveHttpOptions`):

| Var | Default | Purpose |
|-----|---------|---------|
| `MCP_HTTP_HOST` | `127.0.0.1` | Listen interface |
| `MCP_HTTP_PORT` | `3000` | TCP port |
| `MCP_HTTP_PATH` | `/mcp` | Endpoint path |
| `MCP_HTTP_STATEFUL` | `false` | `true` to enable session mode (`Mcp-Session-Id`) |
| `MCP_HTTP_BEARER_TOKEN` | — | Require `Authorization: Bearer <token>` on every request |
| `MCP_HTTP_JSON_RESPONSE` | `false` | `true` to return JSON instead of SSE streams |

Stateless mode spins up a fresh `McpServer`+`StreamableHTTPServerTransport` per POST. Stateful mode keeps a `sessionId → transport` map and expects the client to echo `Mcp-Session-Id`.

## Authentication

Configured via environment variables (never hardcoded), in priority order:

1. **JWT from components** (recommended):
   - `BOOND_USER_TOKEN` — User token (BoondManager → Mon compte → Clé d'API)
   - `BOOND_CLIENT_TOKEN` — Client token (Administration → Espace Développeur → API / Sandbox)
   - `BOOND_CLIENT_KEY` — Client secret key (Administration → Espace Développeur → API / Sandbox)
   - The server generates the JWT (HS256) automatically from these 3 values.
2. **Pre-built JWT**: `BOOND_API_TOKEN` (JWT Bearer)
3. **BasicAuth**: `BOOND_USER` + `BOOND_PASSWORD` (base64-encoded)
- `BOOND_BASE_URL` (optional, defaults to `https://ui.boondmanager.com/api`)

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on push/PR to main. Matrix: Node 20 + 22. Steps: install, lint, typecheck, test:coverage, build.
- **Release** (`.github/workflows/release.yml`): Triggered on version tags.
- **Dependabot**: Configured for npm dependencies.

## Code Style

- ESLint 10 + typescript-eslint (recommended config)
- `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: "^_"`
- `@typescript-eslint/no-explicit-any` as warning
- No semicolons preference not enforced (current code uses semicolons)
- French descriptions in tool metadata (titles, descriptions)
- English for code, comments, and commit messages
