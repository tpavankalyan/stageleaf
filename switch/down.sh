#!/usr/bin/env bash
# Stop the local Switch stack. Data volumes are kept; add --volumes to erase them.
set -euo pipefail
cd "$(dirname "$0")"
docker compose -f docker-compose.switch.yml --env-file .env -p stageleaf-switch \
  --profile collab --profile gateway down "$@"
