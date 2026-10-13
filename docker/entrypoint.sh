#!/bin/sh
# Container start-up: apply pending migrations for the configured database,
# then exec the server (CMD). Set SKIP_MIGRATIONS=true to skip, e.g. when
# several replicas share one Postgres and you migrate separately.
set -eu

# No DATABASE_URL: single-container SQLite in the /data volume.
: "${DATABASE_URL:=file:/data/yakka.db}"

# Relative SQLite paths would resolve differently for the migrator (cwd
# /app/migrator) and the server (cwd /app), so anchor them at /app.
case "$DATABASE_URL" in
  file:/*) ;;
  file:*) rel=${DATABASE_URL#file:}; DATABASE_URL="file:/app/${rel#./}" ;;
esac
export DATABASE_URL

case "$DATABASE_URL" in
  file:*) mkdir -p "$(dirname "${DATABASE_URL#file:}")" ;;
esac

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "yakka: applying database migrations"
  (cd /app/migrator && node node_modules/prisma/build/index.js migrate deploy)
fi

exec "$@"
