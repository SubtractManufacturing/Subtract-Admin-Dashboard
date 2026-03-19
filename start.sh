#!/bin/bash
set -e

if [ "$CONTAINER_ROLE" = "web" ]; then
  echo "Starting web server..."
  exec npm run start
elif [ "$CONTAINER_ROLE" = "worker" ]; then
  echo "Starting background worker..."
  exec npm run start:worker
else
  echo "Starting hybrid container (web + worker)..."
  npm run start &
  npm run start:worker &

  # Wait for any process to exit. If one crashes, the container will exit.
  wait -n

  EXIT_CODE=$?
  echo "A process exited with code $EXIT_CODE. Shutting down..."
  exit $EXIT_CODE
fi
