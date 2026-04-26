# Distribution & marketplaces

This server is published in several places. Most are kept in sync
automatically by the release pipeline; a few require a one-time manual
submission. This file is the trackable checklist for those manual bits, and
the reference for what gets pushed where on each release.

## Where it ships

| Channel | URL / Identifier | Sync mechanism | Frequency |
|---|---|---|---|
| **npm** | [`boondmanager-mcp-server`](https://www.npmjs.com/package/boondmanager-mcp-server) | `npm publish --provenance` step in `release.yml` | every `v*` tag |
| **MCP Registry** | [`io.github.fauguste/boondmanager-mcp-server`](https://registry.modelcontextprotocol.io/) | `mcp-publisher publish` in `release.yml` (GitHub OIDC) | every `v*` tag |
| **GitHub Releases (.mcpb bundle)** | [releases page](https://github.com/fauguste/boondmanager-mcp-server/releases) | `softprops/action-gh-release@v3` in `release.yml`; body sourced from `CHANGELOG.md` | every `v*` tag |
| **GitHub Container Registry** | `ghcr.io/fauguste/boondmanager-mcp-server` | `docker/build-push-action@v6` in `release.yml`; multi-arch (amd64+arm64), tags `:latest`, `:X`, `:X.Y`, `:X.Y.Z` | every `v*` tag |
| **LobeHub MCP marketplace** | [fauguste-boondmanager-mcp-server](https://lobehub.com/mcp/fauguste-boondmanager-mcp-server) | mirrors the MCP Registry (auto, ~24-48 h delay) | per release |
| **Smithery** | [smithery.ai listing](https://smithery.ai/server/@fauguste/boondmanager-mcp-server) | reads `smithery.yaml` from this repo | per push to `main` |

## One-time setup (manual)

These are done once on the project. Re-run only if the values drift or a new
aggregator surfaces.

### 1. GitHub repo topics

Topics are how most aggregators (Glama, PulseMCP, mcp.so, awesome-mcp-servers)
discover the project. Set them with the GitHub CLI — re-running is safe and
overwrites the previous list:

```bash
gh repo edit fauguste/boondmanager-mcp-server \
  --add-topic mcp \
  --add-topic mcp-server \
  --add-topic model-context-protocol \
  --add-topic boondmanager \
  --add-topic crm \
  --add-topic erp \
  --add-topic claude \
  --add-topic claude-code \
  --add-topic lobechat \
  --add-topic anthropic \
  --add-topic typescript
```

### 2. awesome-mcp-servers (community list)

Open a PR adding the entry under the *Business / CRM* category to
[`punkpeye/awesome-mcp-servers`](https://github.com/punkpeye/awesome-mcp-servers):

```markdown
- [fauguste/boondmanager-mcp-server](https://github.com/fauguste/boondmanager-mcp-server) - MCP server for the BoondManager API (ERP/CRM for staffing companies). 156 tools, 6 prompts, 19 resources.
```

### 3. Glama MCP catalogue

Glama auto-indexes from the MCP Registry. If the listing doesn't appear
within a week of the next release, request a manual scan via
[glama.ai/mcp/servers](https://glama.ai/mcp/servers) (footer "Submit your
server"). One-time action.

### 4. PulseMCP

PulseMCP also mirrors the MCP Registry but accepts manual submissions via
[pulsemcp.com](https://pulsemcp.com/) (footer "Submit"). Same as Glama —
only act if the auto-mirror hasn't picked us up.

### 5. mcp.so

[mcp.so](https://mcp.so/) requests submissions through their GitHub repo
(`chatmcp/mcp-directory`). Same pattern: one PR, then it auto-syncs.

## Per-release verification (post-tag)

After every `v*` tag is pushed and the Release workflow turns green, take 2
minutes to spot-check the distribution surface:

1. **npm** — `npm view boondmanager-mcp-server version` matches the tag.
2. **MCP Registry** — the new version is listed at `https://registry.modelcontextprotocol.io/v0/servers/io.github.fauguste/boondmanager-mcp-server`.
3. **GitHub Release** — the body matches the `## [X.Y.Z]` section of `CHANGELOG.md` and the `.mcpb` asset is attached.
4. **GHCR** — `docker pull ghcr.io/fauguste/boondmanager-mcp-server:<tag>` succeeds; `docker manifest inspect` shows both `linux/amd64` and `linux/arm64`.
5. **LobeHub** — within ~48 h, `https://lobehub.com/mcp/fauguste-boondmanager-mcp-server` shows the new description / changelog. If not, it's safe to ignore (LobeHub re-scans on its own cadence).
6. **Smithery** — `https://smithery.ai/server/@fauguste/boondmanager-mcp-server` reflects the latest `smithery.yaml`. Smithery refreshes on every push to `main`, not per tag.

## Adding a new distribution channel

If a new aggregator surfaces, add it here as a new row in the table above
and a one-time-setup subsection. The goal is to keep this file as the
single source of truth for *"where is this server actually published, and
what's the contract with each channel"*.
