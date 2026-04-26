# syntax=docker/dockerfile:1.7
# Multi-stage build for the BoondManager MCP server.
# The runtime image starts the Streamable HTTP transport, suitable for use as
# an MCP gateway (LobeChat, custom MCP host, etc.). For stdio usage, prefer
# `npx boondmanager-mcp-server` directly on the host — Docker's stdio mapping
# is awkward and you don't gain anything by containerising it.

# ---- builder ----
FROM node:22-alpine AS builder
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
FROM node:22-alpine AS runtime
WORKDIR /app

# OCI image annotations — make the image discoverable in registries.
LABEL org.opencontainers.image.title="boondmanager-mcp-server" \
      org.opencontainers.image.description="MCP server for the BoondManager API (HTTP gateway mode)" \
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

# Lightweight liveness check — confirms the HTTP listener is up. We use
# Node's bundled fetch to avoid pulling curl/wget into the image. A 4xx
# (e.g. 405 if the path is POST-only) still proves the listener is alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.MCP_HTTP_PORT+process.env.MCP_HTTP_PATH).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
