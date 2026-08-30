#!/usr/bin/env bash

set -Eeuo pipefail

MAILFLOW_DIR="${MAILFLOW_DIR:-/opt/mailflow}"
MAILFLOW_HEALTH_URL="${MAILFLOW_HEALTH_URL:-https://mail.genoric.com/api/health}"
BACKEND_IMAGE='ghcr.io/yunque0912/mailflow-backend'
FRONTEND_IMAGE='ghcr.io/yunque0912/mailflow-frontend'

usage() {
  cat <<'EOF'
Usage: mailflow-update <X.Y.Z-custom.N>

Environment overrides:
  MAILFLOW_DIR         Compose directory (default: /opt/mailflow)
  MAILFLOW_HEALTH_URL  Public health URL (default: https://mail.genoric.com/api/health)
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi

[[ $# -eq 1 ]] || {
  usage >&2
  exit 2
}

[[ $EUID -eq 0 ]] || die 'Run this command as root (or with sudo).'

version="${1#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-custom\.[0-9]+$ ]] || {
  die "Version must match X.Y.Z-custom.N (without a mutable tag such as latest)."
}

for command in awk curl docker python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is missing: $command"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required.'

cd "$MAILFLOW_DIR" || die "Deployment directory does not exist: $MAILFLOW_DIR"
[[ -f docker-compose.yml ]] || die "Missing $MAILFLOW_DIR/docker-compose.yml"
[[ -f .env ]] || die "Missing $MAILFLOW_DIR/.env"

compose_config="$(docker compose config --format json)" || {
  die 'Production Compose configuration is invalid.'
}
printf '%s' "$compose_config" | python3 -c '
import json
import sys

config = json.load(sys.stdin)
frontend_networks = config["services"]["frontend"]["networks"]
if set(frontend_networks) != {"mailflow", "edge_mailflow"}:
    raise SystemExit("frontend must connect only to mailflow and edge_mailflow")
if "mailflow-ingress" not in frontend_networks["edge_mailflow"].get("aliases", []):
    raise SystemExit("edge_mailflow must define alias mailflow-ingress")
edge_network = config["networks"]["edge_mailflow"]
if edge_network.get("name") != "edge_mailflow" or not edge_network.get("external"):
    raise SystemExit("edge_mailflow must be the external edge_mailflow network")
' || die 'Production Compose does not satisfy the stable Edge network contract.'

if command -v flock >/dev/null 2>&1; then
  exec 9>"$MAILFLOW_DIR/.mailflow-update.lock"
  flock -n 9 || die 'Another MailFlow update is already running.'
fi

mapfile -t version_lines < <(awk -F= '/^MAILFLOW_VERSION=/{print NR ":" substr($0, index($0, "=") + 1)}' .env)
[[ ${#version_lines[@]} -eq 1 ]] || die '.env must contain exactly one MAILFLOW_VERSION entry.'
current_version="${version_lines[0]#*:}"
current_version="${current_version%$'\r'}"

if [[ "$current_version" == "$version" ]]; then
  echo "Reapplying configured MailFlow version $version to complete or verify the deployment."
else
  echo "Updating MailFlow: $current_version -> $version"
fi
echo 'Checking the currently running backend...'
[[ "$(docker inspect -f '{{.State.Health.Status}}' mailflow-backend 2>/dev/null)" == 'healthy' ]] || {
  die 'The current backend is not healthy; update aborted before making changes.'
}
[[ "$(docker inspect -f '{{.State.Health.Status}}' mailflow-frontend 2>/dev/null)" == 'healthy' ]] || {
  die 'The current frontend is not healthy; update aborted before making changes.'
}
curl -fsS "$MAILFLOW_HEALTH_URL" >/dev/null || {
  die "The public health endpoint is unavailable: $MAILFLOW_HEALTH_URL"
}

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_dir="$MAILFLOW_DIR/backups"
database_backup="$backup_dir/mailflow-$timestamp.dump"
config_backup="$backup_dir/deploy-$timestamp"
install -d -m 700 "$backup_dir" "$config_backup"

echo "Backing up PostgreSQL to $database_backup ..."
docker exec mailflow-postgres pg_dump -U mailflow -d mailflow -Fc > "$database_backup"
[[ -s "$database_backup" ]] || die 'PostgreSQL backup is empty.'
docker exec -i mailflow-postgres pg_restore --list < "$database_backup" >/dev/null || {
  die 'PostgreSQL backup validation failed.'
}
sha256sum "$database_backup" > "$database_backup.sha256"

cp -a docker-compose.yml .env "$config_backup/"
echo "Deployment configuration backed up to $config_backup"

env_tmp="$(mktemp "$MAILFLOW_DIR/.env.update.XXXXXX")"
cleanup() {
  [[ -n "${env_tmp:-}" && -e "$env_tmp" ]] && rm -f -- "$env_tmp"
}
trap cleanup EXIT

awk -v version="$version" '
  BEGIN { replaced = 0 }
  /^MAILFLOW_VERSION=/ {
    if (!replaced) print "MAILFLOW_VERSION=" version
    replaced = 1
    next
  }
  { print }
  END { if (!replaced) exit 1 }
' .env > "$env_tmp" || die 'Could not prepare the updated .env file.'
chmod --reference=.env "$env_tmp"
chown --reference=.env "$env_tmp"
mv -f -- "$env_tmp" .env
env_tmp=''

images="$(docker compose config --images)"
grep -Fxq "$BACKEND_IMAGE:$version" <<< "$images" || {
  die "Compose did not resolve the expected backend image: $BACKEND_IMAGE:$version"
}
grep -Fxq "$FRONTEND_IMAGE:$version" <<< "$images" || {
  die "Compose did not resolve the expected frontend image: $FRONTEND_IMAGE:$version"
}

echo 'Resolved application images:'
grep -E '^ghcr\.io/yunque0912/mailflow-(backend|frontend):' <<< "$images"

docker compose pull backend frontend
docker compose up -d backend frontend

echo 'Waiting for frontend and backend health checks...'
for ((attempt = 1; attempt <= 60; attempt++)); do
  backend_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' mailflow-backend 2>/dev/null || true)"
  frontend_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' mailflow-frontend 2>/dev/null || true)"
  if [[ "$backend_health" == 'healthy' && "$frontend_health" == 'healthy' ]]; then
    break
  fi
  if [[ "$backend_health" == 'unhealthy' || "$frontend_health" == 'unhealthy' ]]; then
    die "A container became unhealthy (backend=$backend_health, frontend=$frontend_health). Config backup: $config_backup"
  fi
  sleep 5
done

[[ "${backend_health:-}" == 'healthy' && "${frontend_health:-}" == 'healthy' ]] || {
  die "Timed out waiting for healthy containers. Config backup: $config_backup"
}

backend_running_image="$(docker inspect -f '{{.Config.Image}}' mailflow-backend)"
frontend_running_image="$(docker inspect -f '{{.Config.Image}}' mailflow-frontend)"
[[ "$backend_running_image" == "$BACKEND_IMAGE:$version" ]] || {
  die "Unexpected running backend image: $backend_running_image"
}
[[ "$frontend_running_image" == "$FRONTEND_IMAGE:$version" ]] || {
  die "Unexpected running frontend image: $frontend_running_image"
}

curl -fsS "$MAILFLOW_HEALTH_URL" >/dev/null || {
  die "Containers are healthy, but the public endpoint failed: $MAILFLOW_HEALTH_URL"
}

docker compose ps
docker inspect -f 'image={{.Config.Image}} health={{.State.Health.Status}}' mailflow-backend mailflow-frontend
echo "MailFlow server update completed: $version"
echo "Database backup: $database_backup"
