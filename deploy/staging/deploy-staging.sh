#!/bin/sh
# Deploys, or redeploys, the UAT staging instance from this checkout.
# The whole procedure is docs/install/staging.md; this is its steps 1 to 3
# and 5 as one command.
#
#   sh deploy/staging/deploy-staging.sh [--ref <branch or tag>] [--inbox <address>] [--password <value>]
#   sh deploy/staging/deploy-staging.sh run <openokr command>
#
# The first form checks the host, optionally checks out a ref, installs the
# dependencies, builds the image from this same checkout, and starts the stack
# with the staging overlay. With --inbox it also creates the seven persona
# accounts, once the setup wizard has been finished in a browser; before that
# it says what to do next and stops.
#
# Run it again after new commits and it rebuilds and restarts. Data is kept,
# and the image runs any new migrations when it boots.
#
# The second form runs deploy/docker/openokr with the same settings, for
# `run logs`, `run status`, `run down` or `run destroy`. Calling ./openokr
# directly without them drops the overlay on the next start, which is the
# mistake this form exists to prevent.
#
# Settings, all optional: OPENOKR_DOMAIN, OPENOKR_HTTP_PORT, OPENOKR_HTTPS_PORT,
# OPENOKR_STAGING_DB_PORT, and COMPOSE_PROJECT_NAME for a host that already
# runs another OpenOKR stack.
set -eu

cd "$(dirname "$0")/../.."
REPO="$(pwd)"

log() { echo "deploy-staging: $1"; }
fail() { echo "deploy-staging: $1" >&2; exit 1; }

# The overlay is what publishes Postgres to the seeder. Set here once so every
# ./openokr call below, and every `run`, sees the same stack.
COMPOSE_FILE="compose.yaml:../staging/compose.staging.yaml"
# Docker Desktop for Windows splits COMPOSE_FILE on ";" unless told otherwise.
# Linux already uses ":", so saying so is harmless there.
COMPOSE_PATH_SEPARATOR=":"
export COMPOSE_FILE COMPOSE_PATH_SEPARATOR

run_openokr() {
  ( cd "$REPO/deploy/docker" && ./openokr "$@" )
}

if [ "${1:-}" = "run" ]; then
  shift
  [ $# -gt 0 ] || fail "run needs an openokr command, for example: run logs"
  : "${OPENOKR_IMAGE:=openokr:staging}"
  export OPENOKR_IMAGE
  run_openokr "$@"
  exit $?
fi

ref=""
inbox=""
password=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || fail "--ref needs a branch or tag"; ref="$2"; shift 2 ;;
    --inbox) [ $# -ge 2 ] || fail "--inbox needs an address"; inbox="$2"; shift 2 ;;
    --password) [ $# -ge 2 ] || fail "--password needs a value"; password="$2"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) fail "unknown option $1. See: sh deploy/staging/deploy-staging.sh --help" ;;
  esac
done

# --- the host --------------------------------------------------------------
command -v git >/dev/null 2>&1 || fail "git is not installed."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running, or this user cannot reach it."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not installed (docker compose version failed)."
command -v node >/dev/null 2>&1 || fail "Node is not installed. Node 22 is needed for the seeder."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" = "22" ] || fail "Node $node_major found; the seeder needs Node 22."
command -v pnpm >/dev/null 2>&1 \
  || fail "pnpm is not installed. Run 'corepack enable' once, as a user allowed to."

# Same reason as seed.sh: the seeder would read this file's DATABASE_URL.
[ -f "$REPO/.env" ] && fail "This checkout has a .env. Move it out: the seeder would read its DATABASE_URL instead of the staging container's."

# --- the code --------------------------------------------------------------
if [ -n "$ref" ]; then
  # A checkout with local edits would build an image nobody can reproduce.
  [ -z "$(git status --porcelain)" ] || fail "This checkout has uncommitted changes. Commit or remove them before deploying a ref."
  log "checking out $ref"
  git fetch --quiet origin
  git checkout --quiet "$ref"
  # A branch moves; a tag does not. Fast-forward only, so a rewritten remote
  # branch stops the deploy instead of silently becoming what is tested.
  if git symbolic-ref --quiet HEAD >/dev/null; then
    git pull --quiet --ff-only
  fi
fi
commit="$(git rev-parse --short HEAD)"
log "deploying $commit ($(git log -1 --format=%s))"

log "installing dependencies"
pnpm install --frozen-lockfile >/dev/null

# --- the image -------------------------------------------------------------
# Built from this checkout, because the seeder is code from this checkout
# talking to the database this image migrates. Pulling an image from a
# registry would let the two disagree about the schema.
log "building the image (the first build takes several minutes)"
docker build --quiet -f deploy/docker/Dockerfile \
  -t "openokr:staging-$commit" -t openokr:staging . >/dev/null
OPENOKR_IMAGE="openokr:staging"
export OPENOKR_IMAGE

# --- the stack -------------------------------------------------------------
run_openokr up

# --- the personas ----------------------------------------------------------
# A workspace exists once the setup wizard has run. Asked of the database
# through the container, so it needs neither the overlay port nor psql here.
workspaces="$(
  cd "$REPO/deploy/docker" \
    && MSYS_NO_PATHCONV=1 docker compose exec -T db \
         psql -U openokr -d openokr -tAc "select count(*) from workspaces where deleted_at is null" \
         2>/dev/null | tr -d '[:space:]'
)" || workspaces=""

if [ -z "$inbox" ]; then
  log "done. Next:"
  if [ "${workspaces:-0}" = "0" ]; then
    log "  1. finish the setup and welcome wizards in a browser (UAT M01, M02)"
    log "  2. then: sh deploy/staging/deploy-staging.sh --inbox <your inbox>"
  else
    log "  the wizard has run. Create the personas, if you have not:"
    log "  sh deploy/staging/deploy-staging.sh --inbox <your inbox>"
  fi
  exit 0
fi

if [ "${workspaces:-0}" = "0" ]; then
  log "not seeding yet: nobody has finished the setup wizard."
  log "finish UAT M01 and M02 in a browser, then run this again with --inbox $inbox"
  exit 0
fi

log "creating the persona accounts"
if [ -n "$password" ]; then
  sh "$REPO/deploy/staging/seed.sh" --inbox "$inbox" --password "$password"
else
  sh "$REPO/deploy/staging/seed.sh" --inbox "$inbox"
fi
log "done. Hand the testers the address above, $inbox and the password printed."
