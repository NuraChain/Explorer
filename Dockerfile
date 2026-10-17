# syntax=docker/dockerfile:1

# The whole explorer in one image: the server IS the service - it runs the api and the indexer, and
# in production serves the built client itself, so there is one process and one port.
#
#   docker build -t nura-explorer .
#   docker run -d --name nura-explorer --restart unless-stopped \
#       --env-file server/.env -e PORT=4300 -p 4300:4300 \
#       -v nura-index:/app/server/.data \
#       --add-host host.docker.internal:host-gateway \
#       nura-explorer
#
# `-e PORT` wins over the env file, which was written for a checkout and may name another port -
# and the port published must be the one the server binds. The volume is the index.
#
# Governance and staking read the node's Cosmos REST api and CometBFT rpc, and both default to
# 127.0.0.1 - which inside a container is the CONTAINER, so a node running on the host is not
# there. Point COSMOS_REST_URL and COMETBFT_RPC_URL at http://host.docker.internal:1317 and :26657
# (the --add-host above), and have the node listen on an address the bridge reaches: its api and
# rpc bind loopback by default. Without that the EVM half works and both modules report
# themselves unreachable.

ARG NODE_VERSION=24

# Every stage starts from the manifests alone, so the dependency layers are rebuilt only when a
# manifest or the lockfile changes. All three are needed: `npm ci` in a workspace root refuses a
# lockfile whose workspaces it cannot see.
FROM node:${NODE_VERSION}-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/

# The client bundle, the SSR bundle and the prerender pass. Nothing the build reads comes from the
# environment - EXPLORER_URL and the rest are read by the server at boot - so one image serves any
# deployment.
FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

# The runtime dependencies, installed at the WORKSPACE ROOT and not inside server/. The SSR bundle
# leaves `azerothjs` external, and the server must resolve the same hoisted copy it does: the
# per-request scope lives on one instance, and a page rendered against a second one cannot reach
# the in-process api.
FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim

# Without NODE_ENV=production the server takes its DEVELOPMENT path, which imports vite - a
# devDependency this image does not install - and the boot dies. 4300 is the image's own port, not
# the dev session's 3003 or the code's default 3000.
ENV NODE_ENV=production \
    PORT=4300

# The layout mirrors the checkout, and the server runs from server/ exactly as the systemd unit
# does: `.env`, CLIENT_DIR, SSR_ENTRY, DB_PATH and logs/ all resolve from the working directory,
# so the paths in a server/.env written for a checkout are correct here unchanged.
WORKDIR /app/server

COPY --from=deps /app /app
# No build step for the server - Node >= 24 runs the TypeScript source directly.
COPY server/src src
COPY --from=build /app/application/dist /app/application/dist
COPY --from=build /app/application/dist-server /app/application/dist-server

# sqlite creates the database file but the user has to be able to write the directory; logs/ is
# the NDJSON half of the log (the terminal half is stdout, which is what `docker logs` shows).
RUN mkdir -p .data logs && chown node:node .data logs
USER node

# The index. Without a volume every new container replays the chain from START_BLOCK.
VOLUME ["/app/server/.data"]
EXPOSE 4300

# slim ships no curl; the runtime's own fetch asks the route that exists for this. exitCode rather
# than process.exit(), which tears the process down under fetch's closing handles.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/healthz').then((r) => { process.exitCode = r.ok ? 0 : 1; }, () => { process.exitCode = 1; })"]

# Exec form, so SIGTERM reaches the process: the shutdown handler stops the indexer and closes the
# sqlite handle, and a shell in between would swallow the signal until the kill.
CMD ["node", "src/main.ts"]
