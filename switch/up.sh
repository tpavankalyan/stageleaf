#!/usr/bin/env bash
# Start a local, self-hosted Switch server with its bundled Mattermost and Gateway.
#
#   ./switch/up.sh            # pull the pinned release and start it
#   SWITCH_VERSION=0.31.0 ./switch/up.sh
#
# Uses the official standalone Compose file published with the pinned Switch
# release. Nothing from Switch is vendored into this repository: the file is
# downloaded from the matching release tag on first run. Secrets are generated
# into switch/.env (git-ignored) and never printed.
set -euo pipefail
cd "$(dirname "$0")"

SWITCH_VERSION="${SWITCH_VERSION:-0.31.0}"
COMPOSE_FILE="docker-compose.switch.yml"
COMPOSE_URL="https://raw.githubusercontent.com/sandbox-quantum/switch/switch-v${SWITCH_VERSION}/deploy/local/standalone-docker-compose.yml"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required to generate secrets." >&2; exit 1; }

if [ ! -f "$COMPOSE_FILE" ] || ! grep -q "switch-v${SWITCH_VERSION}" "$COMPOSE_FILE.source" 2>/dev/null; then
  echo "Downloading the Switch ${SWITCH_VERSION} standalone Compose file…"
  curl -fsSL "$COMPOSE_URL" -o "$COMPOSE_FILE"
  echo "$COMPOSE_URL" > "$COMPOSE_FILE.source"
fi

if [ ! -f .env ]; then
  echo "Generating switch/.env with fresh random secrets…"
  umask 077
  cat > .env <<EOF
SWITCH_REGISTRY=ghcr.io
SWITCH_IMAGE_NAMESPACE=sandbox-quantum
SWITCH_VERSION=${SWITCH_VERSION}
GATEWAY_HOST_PORT=3000
API_HOST_PORT=8000
MATTERMOST_HOST_PORT=8065
POSTGRES_HOST_PORT=5432
SWITCH_BIND_ADDR=127.0.0.1
DB_USER=switch_app
DB_PASSWORD=$(openssl rand -hex 24)
DB_OWNER_USER=postgres
DB_OWNER_PASSWORD=$(openssl rand -hex 24)
DB_NAME=switch
TELEMETRY_ENABLED=false
TELEMETRY_ENVIRONMENT=local
ID_SERVER_NAME=localhost
AGENT_REGISTRATION_TOKEN=$(openssl rand -hex 24)
SECRET_KEYS=stageleaf-local:$(openssl rand -hex 32)
GATEWAY_ADMIN_EMAIL=admin@switch.local
GATEWAY_ADMIN_PASSWORD=$(openssl rand -hex 12)
FRONTEND_BASE_URL=http://localhost:3000
MATTERMOST_ADMIN_USER=admin
MATTERMOST_ADMIN_PASSWORD=$(openssl rand -hex 12)
MATTERMOST_TEAM_NAME=stageleaf
MATTERMOST_USER=alex
MATTERMOST_USER_PASSWORD=$(openssl rand -hex 12)
OUTBOUND_ALLOWED_PRIVATE_HOSTS=localhost
# Switch delivers un-mentioned replies in an agent's thread to that agent.
FEATURE_FLAGS_ENABLED=follow_the_conversation
EOF
fi

docker compose -f "$COMPOSE_FILE" --env-file .env -p stageleaf-switch \
  --profile collab --profile gateway up -d

echo
echo "Waiting for the Switch API on http://127.0.0.1:8000/health …"
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "Switch is up."
    echo "  Mattermost:  http://localhost:8065  (team: stageleaf)"
    echo "  Gateway:     http://localhost:3000"
    echo "  Agent API:   http://localhost:8000"
    echo "Next: npm run switch:setup   (registers the Stageleaf agent and creates the event room)"
    exit 0
  fi
  sleep 2
done
echo "Switch did not answer within three minutes. Inspect: docker compose -p stageleaf-switch logs switch" >&2
exit 1
