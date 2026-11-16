#!/bin/sh
# Start Specter on celld: a local object store and one node, with the dashboard at http://127.0.0.1:$PORT/
set -eu
cd "$(dirname "$0")/.."
PORT="${PORT:-9876}"
PATH="$PWD/node_modules/.bin:$HOME/.local/bin:$PATH"
command -v celld >/dev/null || { echo "celld is missing: curl -fsSL https://celld.dev/install.sh | sh" >&2; exit 1; }
exec celld dev . --port "$PORT" --no-watch "$@"
