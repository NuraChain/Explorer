#!/bin/bash

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "error: writing the unit file needs root - re-run with sudo" >&2
  exit 1
fi

SERVICE_NAME="nura-explorer"

# The repo root, and the server half inside it. The server IS the service: it runs the API, the
# indexer, and in production serves the built client itself, so there is only ever one unit.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_PATH="$ROOT/server"

# No build step for the server - Node >= 24 runs the TypeScript source directly, exactly as the
# Dockerfile does. WorkingDirectory is the SERVER directory, not the repo root: main.ts reads
# `.env` from the working directory, and CLIENT_DIR/SSR_ENTRY are written relative to it.
SERVICE_PATH_APP="src/main.ts"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

# systemd resolves a bare ExecStart name against its OWN path, not the invoking shell's, so a node
# that only exists under nvm or ~/.local is a unit that fails to start. Check the list it uses.
node_found=""
for dir in /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
  if [ -x "$dir/node" ]; then
    node_found="$dir/node"
    break
  fi
done

if [ -z "$node_found" ]; then
  echo "warning: no 'node' in systemd's search path - link one there (e.g. ln -s \"\$(command -v node)\" /usr/local/bin/node)" >&2
fi

# The CLIENT half does have a build step, and production imports the SSR bundle at boot - a
# missing one is a service that restart-loops. Say so here rather than in the log at 3am.
if [ ! -f "$ROOT/application/dist-server/entry.server.js" ]; then
  echo "warning: application/dist-server/entry.server.js is missing - run 'npm run build' before starting" >&2
fi

if [ ! -f "$SERVICE_PATH/.env" ]; then
  echo "warning: server/.env is missing - the service would boot against the defaults, not your chain" >&2
fi

# systemd does not create the directory it is told to log into.
mkdir -p "$SERVICE_PATH/logs"

echo "> Installing systemd service (${SERVICE_FILE})..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nura Explorer
After=network.target

[Service]
RestartSec=5
Restart=always
# Without this the server runs its DEVELOPMENT path: no SSR, and the devtools bridge attaches.
Environment=NODE_ENV=production
WorkingDirectory=$SERVICE_PATH
# Bare 'node', not a resolved path: systemd looks a bare name up in its own fixed search path
# (/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin), so an upgrade that moves the
# binary needs no reinstall of the unit.
ExecStart=node $SERVICE_PATH_APP

StandardOutput=file:$SERVICE_PATH/logs/service_output.log
StandardError=file:$SERVICE_PATH/logs/service_error.log

LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo "> Service Installed."
