#!/usr/bin/env bash
# Install all dependencies for the Journal dev stack (idempotent).
# Run once after cloning, and any time uv.lock / package-lock.json change.
# Prerequisites: uv (fetches its own Python 3.12) and Node 20.19+/22.12+.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- prerequisite checks -----------------------------------------------------
if ! command -v uv >/dev/null 2>&1; then
  echo "setup.sh: 'uv' is not installed — https://docs.astral.sh/uv/getting-started/installation/" >&2
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "setup.sh: 'node' is not installed — need Node 20.19+ or 22.12+ (Vite 8)" >&2
  exit 1
fi

node_ok() {
  local major minor
  IFS=. read -r major minor _ <<<"$(node -p 'process.versions.node')"
  (( major > 22 )) || { (( major == 22 )) && (( minor >= 12 )); } || { (( major == 20 )) && (( minor >= 19 )); }
}
if ! node_ok; then
  echo "setup.sh: Node $(node -p 'process.versions.node') is too old — Vite 8 needs ^20.19.0 || >=22.12.0" >&2
  exit 1
fi

# --- dependencies ------------------------------------------------------------
echo "setup.sh: backend (uv sync — creates backend/.venv from uv.lock)…"
(cd "$ROOT/backend" && uv sync)

echo "setup.sh: frontend (npm install)…"
(cd "$ROOT/frontend" && npm install)

echo "setup.sh: done — start everything with ./dev.sh"
