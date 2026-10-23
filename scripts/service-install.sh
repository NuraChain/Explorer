#!/bin/bash

set -euo pipefail

NODE_PATH="${NODE_PATH:-$(command -v node || true)}"

if [ -z "$NODE_PATH" ]; then
  echo "error: node binary not found (set NODE_PATH to override)" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "error: writing the unit file needs root - re-run with sudo" >&2
  exit 1
fi

SERVICE_NAME="nura-explorer"

# The repo root, and the server half inside it. The server IS the service: it runs the API, the
# indexer, and in production serves the built client itself, so there is only ever one unit.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_PATH="$ROOT/server"

# No build step for the server - Node >= 24 runs the TypeScript source directly.
# WorkingDirectory is the SERVER directory, not the repo root: main.ts reads `.env` from the
# working directory, and CLIENT_DIR/SSR_ENTRY are written relative to it.
SERVICE_PATH_APP="src/main.ts"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

# The CLIENT half does have a build step, and production imports the SSR bundle at boot - a
# missing one is a service that restart-loops. Say so here rather than in the log at 3am.
if [ ! -f "$ROOT/application/dist-server/entry.server.js" ]; then
  echo "warning: application/dist-server/entry.server.js is missing - run 'npm run build' before starting" >&2
fi

if [ ! -f "$SERVICE_PATH/.env" ]; then
  echo "warning: server/.env is missing - the service would boot against the defaults, not your chain" >&2
elif ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=' "$SERVICE_PATH/.env"; then
  # The one key with no default: without it the server refuses to boot and restart-loops. The
  # pattern takes every spelling process.loadEnvFile() does - an `export` prefix, spaces round `=`.
  echo "warning: server/.env sets no DATABASE_URL - the service needs a PostgreSQL to keep its index in" >&2
fi

# systemd does not create the directory it is told to log into.
mkdir -p "$SERVICE_PATH/logs"

echo "> Installing systemd service (${SERVICE_FILE})..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nura Explorer
# After the network is UP rather than merely configured, and after a local PostgreSQL when there is
# one - ordering only, never Requires: the database may live on another host, and a Debian
# postgresql.service reports started before its cluster does. Restart=always covers that race.
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
RestartSec=5
Restart=always
# Without this the server runs its DEVELOPMENT path: no SSR, and the devtools bridge attaches.
Environment=NODE_ENV=production
WorkingDirectory=$SERVICE_PATH
# Quoted: systemd splits ExecStart on whitespace, and an interpreter installed under a path with
# a space in it (nvm on some setups, /opt installs) would otherwise be read as two arguments.
ExecStart="$NODE_PATH" $SERVICE_PATH_APP

StandardOutput=file:$SERVICE_PATH/logs/service_output.log
StandardError=file:$SERVICE_PATH/logs/service_error.log

LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

systemctl enable "$SERVICE_NAME"

echo "> Service Installed."
