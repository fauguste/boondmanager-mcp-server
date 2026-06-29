# syntax=docker/dockerfile:1.7
# Multi-stage build for the BoondManager MCP server.
# The runtime image starts the Streamable HTTP transport, suitable for use as
# an MCP gateway (LobeChat, custom MCP host, etc.). For stdio usage, prefer
# `npx boondmanager-mcp-server` directly on the host — Docker's stdio mapping
# is awkward and you don't gain anything by containerising it.
#
# Authentication model (HTTP transport): the MCP server is an OAuth2
# *protected resource*. It holds **no secrets**: no client_secret, no
# refresh token, no token store. Each MCP request from the client must
# carry `Authorization: Bearer <boond_access_token>`; the server forwards
# the token verbatim to BoondManager. The client (Claude Desktop, Claude
# Code, MCP gateway, …) performs the OAuth dance against BoondManager
# directly and refreshes its own tokens.
#
# The server publishes RFC 9728 protected-resource metadata at
# `/.well-known/oauth-protected-resource` so MCP clients auto-discover
# the BoondManager authorization server.
#
# See docs/oauth.md for the full flow.

# ---- builder ----
# Pinned by multi-arch index digest for reproducible, tamper-evident builds.
# Dependabot (docker ecosystem) keeps the digest fresh as `26-alpine` moves.
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS builder
WORKDIR /app

# Install only what's needed to build, with cache-friendly layering.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for the final image.
RUN npm prune --omit=dev


# ---- runtime ----
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS runtime
WORKDIR /app

# OCI image annotations — make the image discoverable in registries.
LABEL org.opencontainers.image.title="boondmanager-mcp-server" \
      org.opencontainers.image.description="MCP server for the BoondManager API (HTTP gateway mode, OAuth2 protected resource)" \
      org.opencontainers.image.source="https://github.com/fauguste/boondmanager-mcp-server" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Silamir"

# Run unprivileged. node:alpine ships a uid 1000 `node` user we can reuse.
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

# HTTP transport defaults — override at run time as needed.
# MCP_HTTP_HOST=0.0.0.0 is required inside the container so the port is
# reachable from the host (the server defaults to 127.0.0.1 for stdio safety).
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000 \
    MCP_HTTP_PATH=/mcp

EXPOSE 3000

# Lightweight liveness check — /healthz is unauthenticated, exempt from Host
# validation, and reports the server version and session count.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.MCP_HTTP_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
