#!/bin/sh
# Container start: bring the schema up to date, optionally seed the story cast, then
# hand PID 1 to Node so it receives SIGTERM directly (graceful shutdown).
set -e

echo "[entrypoint] running migrations"
node src/db/cli.js migrate

if [ "$SEED_ON_START" = "true" ] || [ "$SEED_ON_START" = "1" ]; then
  echo "[entrypoint] seeding story cast (idempotent)"
  node src/db/cli.js seed
fi

echo "[entrypoint] starting API"
exec node src/server.js
