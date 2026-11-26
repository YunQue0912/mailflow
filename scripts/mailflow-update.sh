#!/usr/bin/env bash

set -Eeuo pipefail

MAILFLOW_DIR="${MAILFLOW_DIR:-/opt/mailflow}"
MAILFLOW_HEALTH_URL="${MAILFLOW_HEALTH_URL:-https://mail.genoric.com/api/health}"
MAILFLOW_UPDATE_WAIT_SECONDS="${MAILFLOW_UPDATE_WAIT_SECONDS:-900}"
BACKEND_IMAGE='ghcr.io/yunque0912/mailflow-backend'
FRONTEND_IMAGE='ghcr.io/yunque0912/mailflow-frontend'

usage() {
  cat <<'EOF'
Usage: mailflow-update <X.Y.Z-custom.N>

Environment overrides:
  MAILFLOW_DIR         Compose directory (default: /opt/mailflow)
  MAILFLOW_HEALTH_URL  Public health URL (default: https://mail.genoric.com/api/health)
  MAILFLOW_UPDATE_WAIT_SECONDS  Startup deadline per phase, including migrations (30-86400; default: 900)
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
[[ "$MAILFLOW_UPDATE_WAIT_SECONDS" =~ ^[1-9][0-9]{1,4}$ ]] &&
  (( MAILFLOW_UPDATE_WAIT_SECONDS >= 30 && MAILFLOW_UPDATE_WAIT_SECONDS <= 86400 )) || {
  die 'MAILFLOW_UPDATE_WAIT_SECONDS must be a whole number from 30 to 86400.'
}

for command in awk curl docker python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is missing: $command"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required.'

cd "$MAILFLOW_DIR" || die "Deployment directory does not exist: $MAILFLOW_DIR"
[[ -f docker-compose.yml ]] || die "Missing $MAILFLOW_DIR/docker-compose.yml"
[[ -f .env ]] || die "Missing $MAILFLOW_DIR/.env"

compose_files=(docker-compose.yml)
for override in compose.override.yml compose.override.yaml docker-compose.override.yml docker-compose.override.yaml; do
  if [[ -f "$override" ]]; then
    compose_files+=("$override")
    break
  fi
done
compose=(docker compose)
for file in "${compose_files[@]}"; do
  compose+=(-f "$file")
done

if command -v flock >/dev/null 2>&1; then
  exec 9>"$MAILFLOW_DIR/.mailflow-update.lock"
  flock -n 9 || die 'Another MailFlow update is already running.'
fi

compose_config="$("${compose[@]}" config --format json)" || {
  die 'Production Compose configuration is invalid.'
}
running_backend_image="$(docker inspect -f '{{.Config.Image}}' mailflow-backend 2>/dev/null || true)"
running_backend_version="${running_backend_image#"$BACKEND_IMAGE:"}"
printf '%s' "$compose_config" | python3 -c '
import json
import re
import sys

config = json.load(sys.stdin)
services = config["services"]
backend = services["backend"]
frontend = services["frontend"]
duration = str(backend.get("stop_grace_period", ""))
parts = re.findall(r"([0-9]+(?:\.[0-9]+)?)(ns|us|µs|ms|s|m|h)", duration)
scales = {"ns": 1e-9, "us": 1e-6, "µs": 1e-6, "ms": 1e-3, "s": 1, "m": 60, "h": 3600}
if not parts or "".join(number + unit for number, unit in parts) != duration or sum(float(number) * scales[unit] for number, unit in parts) < 30:
    raise SystemExit("backend must set stop_grace_period to at least 30s so sends can finish")
frontend_networks = frontend["networks"]
if set(frontend_networks) != {"mailflow", "edge_mailflow"}:
    raise SystemExit("frontend must connect only to mailflow and edge_mailflow")
if frontend.get("ports"):
    raise SystemExit("frontend must use the Edge Gateway without publishing host ports")
if "mailflow-ingress" not in frontend_networks["edge_mailflow"].get("aliases", []):
    raise SystemExit("edge_mailflow must define alias mailflow-ingress")
edge_network = config["networks"]["edge_mailflow"]
if edge_network.get("name") != "edge_mailflow" or not edge_network.get("external"):
    raise SystemExit("edge_mailflow must be the external edge_mailflow network")

database = backend.get("environment", {})
if database.get("DATABASE_URL"):
    raise SystemExit("DATABASE_URL needs a separate backup plan; this updater backs up the bundled Postgres database")
postgres = services.get("postgres", {})
if postgres.get("container_name") != "mailflow-postgres":
    raise SystemExit("the updater requires the bundled mailflow-postgres database")
postgres_hosts = {"postgres", "mailflow-postgres"}
for network in (postgres.get("networks") or {}).values():
    postgres_hosts.update((network or {}).get("aliases", []))
    postgres_hosts.add((network or {}).get("ipv4_address"))
    postgres_hosts.add((network or {}).get("ipv6_address"))
if (database.get("DB_HOST") or "postgres") not in postgres_hosts or str(database.get("DB_PORT") or "5432") != "5432":
    raise SystemExit("backend must use the bundled Postgres service for the updater backup to cover its database")
if any((database.get(key) or "mailflow") != "mailflow" for key in ("DB_NAME", "DB_USER")):
    raise SystemExit("the updater backup requires the production mailflow database and role")

def caddy_release(version):
    match = re.fullmatch(r"([0-9]+)\.([0-9]+)\.[0-9]+-custom\.[0-9]+", version)
    return bool(match and tuple(map(int, match.groups())) >= (4, 4))

target_uses_caddy = caddy_release(sys.argv[1])
if caddy_release(sys.argv[2]) and not target_uses_caddy:
    raise SystemExit("use the pre-upgrade database and Compose restore procedure to return to 4.3 or earlier")

if target_uses_caddy:
    if "redis" in services or "caddy" in services or "redis" in backend.get("depends_on", {}):
        raise SystemExit("prepare the 4.4+ Compose files without the legacy Redis and standalone Caddy services")
    frontend_env = frontend.get("environment", {})
    mode = (frontend_env.get("TLS_MODE") or "").lower()
    legacy_off = (frontend_env.get("NGINX_TLS") or "").lower() in {"off", "false", "0", "no"}
    if mode != "off" and not (not mode and legacy_off):
        raise SystemExit("frontend must run in HTTP-only mode behind the Edge Gateway (TLS_MODE=off)")
    nginx_root = "/usr/share/nginx/html"
    for mount in frontend.get("volumes", []):
        target = mount["target"]
        if target == nginx_root or target.startswith(nginx_root + "/"):
            raise SystemExit("move public-site bind mounts from the nginx document root to /srv before upgrading")
' "$version" "$running_backend_version" || die 'Production Compose preflight failed. See contrib/UPSTREAM_SYNC_4.5.1_DEPLOYMENT.md for the Caddy and Postgres cutover.'
unset compose_config

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

cp -a "${compose_files[@]}" .env "$config_backup/"
echo "Deployment configuration backed up to $config_backup"

env_tmp="$(mktemp "$MAILFLOW_DIR/.env.update.XXXXXX")"
cleanup() {
  if [[ -n "${env_tmp:-}" && -e "$env_tmp" ]]; then
    rm -f -- "$env_tmp"
  fi
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

images="$("${compose[@]}" --env-file "$env_tmp" config --images)"
grep -Fxq "$BACKEND_IMAGE:$version" <<< "$images" || {
  die "Compose did not resolve the expected backend image: $BACKEND_IMAGE:$version"
}
grep -Fxq "$FRONTEND_IMAGE:$version" <<< "$images" || {
  die "Compose did not resolve the expected frontend image: $FRONTEND_IMAGE:$version"
}

echo 'Resolved application images:'
grep -E '^ghcr\.io/yunque0912/mailflow-(backend|frontend):' <<< "$images"

"${compose[@]}" --env-file "$env_tmp" pull backend frontend
mv -f -- "$env_tmp" .env
env_tmp=''

wait_for_health() {
  local deadline=$((SECONDS + MAILFLOW_UPDATE_WAIT_SECONDS))
  local container status ready previous=''
  while (( SECONDS < deadline )); do
    ready=true
    local summary=''
    for container in "$@"; do
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
      [[ "$status" == 'healthy' ]] || ready=false
      summary+="$container=${status:-missing} "
    done
    [[ "$ready" == true ]] && return 0
    if [[ "$summary" != "$previous" ]]; then
      echo "Waiting for startup/migrations: $summary"
      previous="$summary"
    fi
    # A migration runs before the HTTP listener exists and can outlast Docker health retries.
    # An initial unhealthy result is therefore not a failed migration; wait for the deadline.
    sleep 5
  done
  die "Startup deadline (${MAILFLOW_UPDATE_WAIT_SECONDS}s) exceeded: $summary Config backup: $config_backup. Inspect backend logs; do not roll back images automatically after migrations."
}

# Start the backend separately so frontend depends_on cannot abort a legitimate long migration.
# PostgreSQL stays running on the existing volume. A legacy Redis container can be retired
# after cutover verification without removing the rollback volume.
"${compose[@]}" up -d --no-deps backend
wait_for_health mailflow-backend
"${compose[@]}" up -d --no-deps frontend
wait_for_health mailflow-backend mailflow-frontend

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

"${compose[@]}" ps
docker inspect -f 'image={{.Config.Image}} health={{.State.Health.Status}}' mailflow-backend mailflow-frontend
echo "MailFlow server update completed: $version"
echo "Database backup: $database_backup"
